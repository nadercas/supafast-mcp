import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { getConnection } from '../utils/connection.js';
import { logError, logInfo } from '../utils/logger.js';
import * as fs from 'fs';
import * as path from 'path';

const getFunctionsDir = (): string => {
  const dir = process.env.SUPABASE_FUNCTIONS_DIR;
  if (!dir) throw new Error('SUPABASE_FUNCTIONS_DIR not set in environment');
  if (!fs.existsSync(dir)) throw new Error(`Functions directory not found: ${dir}`);
  return dir;
};

export const edgeFunctionTools: Tool[] = [
  {
    name: 'create_edge_function',
    description: 'Create or update a self-hosted Supabase Edge Function by writing it to the functions directory',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Function name (slug, e.g. hello-world)' },
        source: { type: 'string', description: 'TypeScript source code for the function' },
        importMap: {
          type: 'object',
          description: 'Optional import map (imports key → URL map)',
          additionalProperties: { type: 'string' }
        },
        verifyJWT: {
          type: 'boolean',
          description: 'Whether to require a valid JWT (default: true)',
          default: true
        }
      },
      required: ['name', 'source']
    }
  },
  {
    name: 'list_edge_functions',
    description: 'List all deployed Edge Functions in the self-hosted functions directory',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'delete_edge_function',
    description: 'Delete a self-hosted Edge Function by removing it from the functions directory',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Function name to delete' }
      },
      required: ['name']
    }
  },
  {
    name: 'invoke_edge_function',
    description: 'Invoke a deployed Edge Function',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Function name' },
        payload: { type: 'object', description: 'JSON payload to send', additionalProperties: true },
        headers: { type: 'object', description: 'Additional HTTP headers', additionalProperties: { type: 'string' } }
      },
      required: ['name']
    }
  }
];

export const handleCreateEdgeFunction = async (args: unknown) => {
  const { name, source, importMap, verifyJWT } = args as {
    name: string;
    source: string;
    importMap?: Record<string, string>;
    verifyJWT?: boolean;
  };

  try {
    const functionsDir = getFunctionsDir();
    const fnDir = path.join(functionsDir, name);

    fs.mkdirSync(fnDir, { recursive: true });
    fs.writeFileSync(path.join(fnDir, 'index.ts'), source, 'utf8');

    if (importMap && Object.keys(importMap).length > 0) {
      fs.writeFileSync(
        path.join(fnDir, 'import_map.json'),
        JSON.stringify({ imports: importMap }, null, 2),
        'utf8'
      );
    }

    logInfo(`Edge Function '${name}' written to ${fnDir}`);

    return {
      success: true,
      message: `Edge Function '${name}' deployed successfully`,
      path: fnDir,
      verifyJWT: verifyJWT ?? true,
      note: 'Function is live immediately — the Edge Runtime hot-reloads on file changes'
    };
  } catch (error) {
    logError(error as Error, 'create_edge_function');
    return { success: false, error: (error as Error).message };
  }
};

export const handleListEdgeFunctions = async () => {
  try {
    const functionsDir = getFunctionsDir();
    const entries = fs.readdirSync(functionsDir, { withFileTypes: true });
    const functions = entries
      .filter(e => e.isDirectory())
      .map(e => {
        const fnDir = path.join(functionsDir, e.name);
        const hasIndex = fs.existsSync(path.join(fnDir, 'index.ts'));
        const hasImportMap = fs.existsSync(path.join(fnDir, 'import_map.json'));
        const stat = fs.statSync(path.join(fnDir, 'index.ts'));
        return {
          name: e.name,
          hasIndex,
          hasImportMap,
          updatedAt: stat.mtime.toISOString()
        };
      });

    logInfo(`Listed ${functions.length} edge functions`);
    return { success: true, functions };
  } catch (error) {
    logError(error as Error, 'list_edge_functions');
    return { success: false, error: (error as Error).message };
  }
};

export const handleDeleteEdgeFunction = async (args: unknown) => {
  const { name } = args as { name: string };

  try {
    const functionsDir = getFunctionsDir();
    const fnDir = path.join(functionsDir, name);

    if (!fs.existsSync(fnDir)) {
      return { success: false, error: `Function '${name}' not found` };
    }

    fs.rmSync(fnDir, { recursive: true, force: true });
    logInfo(`Edge Function '${name}' deleted`);

    return { success: true, message: `Edge Function '${name}' deleted successfully` };
  } catch (error) {
    logError(error as Error, 'delete_edge_function');
    return { success: false, error: (error as Error).message };
  }
};

export const handleInvokeEdgeFunction = async (args: unknown) => {
  const { name, payload, headers } = args as {
    name: string;
    payload?: any;
    headers?: Record<string, string>;
  };
  const connection = getConnection();

  try {
    const supabase = connection.getSupabaseClient();
    const invokeOptions: any = {};
    if (payload !== undefined) invokeOptions.body = payload;
    if (headers !== undefined) invokeOptions.headers = headers;

    const { data, error } = await supabase.functions.invoke(name, invokeOptions);

    if (error) {
      logError(new Error(error.message), 'invoke_edge_function');
      return { success: false, error: error.message };
    }

    logInfo(`Edge Function '${name}' invoked successfully`);
    return { success: true, result: data, message: `Edge Function '${name}' invoked successfully` };
  } catch (error) {
    logError(error as Error, 'invoke_edge_function');
    return { success: false, error: (error as Error).message };
  }
};
