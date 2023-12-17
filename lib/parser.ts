import { Options as SucraseOptions, transform as transformTs } from "sucrase";
// @ts-ignore
import parseComments from "multilang-extract-comments";
// @ts-ignore
import { format as beautify } from "prettier";

import { AccountID, Aliases, Code, ConfigComment, IPFSMap, Log, Modules } from "./types";
import { BaseConfig } from "@/lib/config";

const SYNTAX = {
  keyword: '@',
  separator: '/',
  wrapper: '{}',

  /* 
   * Examples: 
   * - const hello = "Hello, @{alias/name}!";
   * - const modules = VM.require(`@{module/utils/name}`);
   * - const ipfs = <img src="@{ipfs/brand/logo.svg}" />
   * - const config = "by @{config/accounts/signer}";
   */
};


interface Output {
  code: Code,
  logs: Array<Log>,
};

export interface TranspileJSOptions {
  compileTypeScript?: boolean;
  format?: boolean;
};

export async function transpileTypescript(code: Code, tsConfig?: any): Promise<Output> {
  let transpiledCode = code, logs: Log[] = [];

  const sucraseOptions: SucraseOptions = {
    transforms: ["typescript", "jsx"],
    jsxRuntime: "preserve",
    enableLegacyBabel5ModuleInterop: true, // Preserve CommonJS import/export statements
    disableESTransforms: true,
    ...(tsConfig && tsConfig.compilerOptions),
  };

  try {
    transpiledCode = transformTs(code, sucraseOptions).code;
  } catch (e: any) {
    logs.push({
      message: e.message || "Something went wrong while transpiling TypeScript",
      level: "error",
    });
  }

  // if no default export is found, add error
  if (!transpiledCode.match(/export\s+default\s/g)) {
    logs.push({
      message: "No default export found",
      level: "warn",
    });
  }

  // replace the "export default x;" with "return x(props);"
  transpiledCode = transpiledCode.replace(
    /export\s+default\s+(\w+);/,
    "return $1(props);",
  );

  // replace the "export default *" with "return *"
  transpiledCode = transpiledCode.replace(
    /export\s+default\s+/,
    "return ",
  );

  return {
    code: transpiledCode,
    logs: logs,
  }
}

const wrap = (code: Code, scope: string = "") => {
  return `${SYNTAX.keyword}${SYNTAX.wrapper[0]}${scope}${SYNTAX.separator}${code}${SYNTAX.wrapper[1]}`;
};

export function evalConfig(path: string[], config: BaseConfig): Output {
  if (path[0] === 'account') {
    path = ['accounts', 'deploy'];
  }

  let notFound = false;
  let value = path.reduce((obj: any, key: string) => {
    if (!obj || !obj.hasOwnProperty(key)) {
      notFound = true;
      return undefined;
    }
    return obj[key];
  }, config);

  const logs: Log[] = [];

  if (notFound) {
    value = wrap(path.join(SYNTAX.separator), "config");
    logs.push({
      message: `Config value not found: ${value}`,
      level: 'warn',
    });
  }

  return {
    code: value,
    logs: logs,
  };
};

export function evalModule(path: string[], modules: Modules, account: AccountID): Output {
  const module_path = path.join('.');
  const logs: Log[] = [];
  if (!modules.includes(module_path)) {
    logs.push({
      message: `Imported module not found locally: ${wrap(path.join(SYNTAX.separator), "module")}`,
      level: 'warn',
    });
  }
  const value = account + "/widget/" + path.join('.') + ".module";
  return {
    code: value,
    logs: logs,
  }
}

export function evalIPFS(path: string[], ipfsMap: IPFSMap, ipfsGateway: string): Output {
  const logs: Log[] = [];
  const ipfs_path = path.join(SYNTAX.separator);

  let value = ipfsGateway.replace(/\/$/, '') + "/" + ipfsMap?.[ipfs_path];

  if (!ipfsMap.hasOwnProperty(ipfs_path)) {
    value = wrap(ipfs_path, "ipfs");
    logs.push({
      message: `IPFS file or mapping not found: ${value}`,
      level: 'warn',
    });
  }

  return {
    code: value,
    logs: logs,
  }
};

export function evalAlias(path: string[], aliases: Aliases): Output {
  const logs: Log[] = [];
  const alias_path = path.join(SYNTAX.separator);
  let value = aliases?.[alias_path];
  if (!aliases.hasOwnProperty(alias_path)) {
    value = wrap(alias_path, "alias");
    logs.push({
      message: `Imported alias not found: ${value}`,
      level: 'warn',
    });
  }
  return {
    code: value,
    logs: logs,
  }
};


export interface EvalCustomSyntaxParams {
  config: BaseConfig,
  modules: Modules,
  ipfsMap: IPFSMap,
  ipfsGateway: string,
  aliases: Aliases,
};

export function evalCustomSyntax(code: Code, params: EvalCustomSyntaxParams): Output {
  const logs: Array<Log> = [];
  const regex = new RegExp(`${SYNTAX.keyword}${SYNTAX.wrapper[0]}([^${SYNTAX.wrapper[1]}]+)${SYNTAX.wrapper[1]}`, 'g');

  code = code.replace(regex, (_match, expression) => {
    expression = expression.split(SYNTAX.separator);
    const keyword = expression[0];
    const path = expression.slice(1);


    let evl: Output;
    switch (keyword) {
      case 'config':
        evl = evalConfig(path, params.config);
        break;
      case 'module':
        evl = evalModule(path, params.modules, params.config.accounts?.deploy ?? "");
        break;
      case 'ipfs':
        evl = evalIPFS(path, params.ipfsMap, params.ipfsGateway);
        break;
      case 'alias':
        evl = evalAlias(path, params.aliases);
        break;
      default:
        evl = {
          code: path,
          logs: [
            {
              message: `Unknown keyword: ${keyword}`,
              level: 'warn',
            }
          ]
        };
    };
    logs.push(...evl.logs);
    return evl.code;
  });
  return { code: code, logs: logs };
}

export async function extractConfigComments(code: Code): Promise<Output & { configs: ConfigComment[] }> {
  const comments = parseComments(code);
  const lines = code.split('\n');
  let codeWithoutConfigComments: string = '';

  const configs = Object.keys(comments).map(key => {
    const comment = comments[key];
    const match = comment.content.match(/@(\w+)(\(.*\))?/);
    if (match) {
      // Remove the lines with config comments
      for (let i = comment.begin; i <= comment.end; i++) {
        lines[i - 1] = ''; // Replace the line with an empty string
      }

      return {
        name: match[1],
        value: match[2] ? match[2].slice(1, -1) : undefined,
        begin: comment.begin,
        end: comment.end,
      };
    }
    return null;
  }).filter(Boolean) as ConfigComment[];

  codeWithoutConfigComments = lines.filter(line => line !== '').join('\n');

  return {
    configs,
    code: codeWithoutConfigComments,
    logs: [],
  };
}

export async function format(code: Code): Promise<Output> {
  const logs: Array<Log> = [];
  let new_code = code;
  try {
    beautify(code, {
      parser: "babel",
    });
  } catch (e: any) {
    logs.push({
      message: e.message || "Something went wrong while formatting",
      level: "error",
    });
  }


  return {
    code: new_code,
    logs: logs,
  }
};

export async function transpileJS(code: Code, importParams: EvalCustomSyntaxParams, opts?: TranspileJSOptions): Promise<Output> {
  let output_code = code;
  let logs: Array<Log> = [];
  const ecc_res = await extractConfigComments(code);
  logs = logs.concat(ecc_res.logs);
  output_code = ecc_res.code;
  const config_comments = ecc_res.configs;

  if (opts?.compileTypeScript) {
    const tt_res = await transpileTypescript(output_code);
    output_code = tt_res.code;
    logs = logs.concat(tt_res.logs);
  }

  if (config_comments.find(c => c.name === 'skip')) {
    logs.push({
      message: 'Skipping compilation because of @skip comment',
      level: 'info',
      source: {
        line: config_comments.find(c => c.name === 'skip')?.begin,
      }
    });
    return {
      code: output_code,
      logs: logs,
    };
  }

  const ri_res = evalCustomSyntax(output_code, importParams);
  output_code = ri_res.code;
  logs = logs.concat(ri_res.logs);

  if (opts?.format ?? true) {
    const f_res = await format(output_code);
    output_code = f_res.code;
    logs = logs.concat(f_res.logs);
  }

  return {
    code: output_code,
    logs: logs,
  };
}
