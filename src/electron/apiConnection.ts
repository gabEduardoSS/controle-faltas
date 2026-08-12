import { ipcMain } from "electron";
import axios, { type AxiosInstance } from "axios";
import { wrapper } from "axios-cookiejar-support";
import { CookieJar } from "tough-cookie";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import * as crypto from "crypto";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORTAL_URL = "https://unipar.lyceum.com.br/aluno/"; // página de login (sem /auth)
const LOGIN_URL = "https://unipar.lyceum.com.br/aluno/auth";
const API_BASE = "https://unipar.lyceum.com.br/aluno/apix";
const PUBLIC_KEY_URL = "https://unipar.lyceum.com.br/aluno/config-properties/public-key";
const SESSION_FILE = path.resolve(__dirname, "session.json");

/**
 * Cria um client axios com um cookie jar próprio.
 * Isso é o equivalente do requests.Session() do Python: sem isso,
 * cada chamada do axios seria "sem estado" e não manteria cookies entre requisições.
 */
function criarClienteComSessao(jar: CookieJar): AxiosInstance {
  const client = wrapper(
    axios.create({
      jar,
      withCredentials: true,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      },
      // Não lançar exceção automática em status >= 400;
      // vamos checar manualmente, igual o resp.raise_for_status() do Python.
      validateStatus: () => true,
    })
  );
  return client;
}

/**
 * Busca a chave pública RSA exposta publicamente pelo servidor
 * (a mesma que o front-end usa via JSEncrypt).
 */
async function obterChavePublica(client: AxiosInstance): Promise<string> {
  const resp = await client.get(PUBLIC_KEY_URL);
  const pemBruto = String(resp.data).trim();
  return formatarPem(pemBruto);
}

/**
 * O servidor devolve o PEM inteiro numa linha só, sem quebras.
 * O parser de PEM do Node/OpenSSL espera o corpo base64 quebrado
 * em linhas de até 64 caracteres, então reformatamos aqui.
 */
function formatarPem(pemBruto: string): string {
  const header = "-----BEGIN PUBLIC KEY-----";
  const footer = "-----END PUBLIC KEY-----";
  const corpo = pemBruto.replace(header, "").replace(footer, "").trim();
  const linhas = corpo.match(/.{1,64}/g) ?? [];
  return `${header}\n${linhas.join("\n")}\n${footer}\n`;
}

/**
 * Replica exatamente o que o JSEncrypt faz no front-end:
 * RSA com padding PKCS1 v1.5, resultado em base64.
 */
function criptografarSenha(senhaTextoPuro: string, pemChavePublica: string): string {
  const bufferSenha = Buffer.from(senhaTextoPuro, "utf-8");
  const cifrado = crypto.publicEncrypt(
    {
      key: pemChavePublica,
      padding: crypto.constants.RSA_PKCS1_PADDING, // PKCS1 v1.5 (não é o OAEP mais moderno)
    },
    bufferSenha
  );
  return cifrado.toString("base64");
}

async function fazerLogin(USUARIO: string, SENHA: string): Promise<{ client: AxiosInstance; jar: CookieJar }> {
  const jar = new CookieJar();
  const client = criarClienteComSessao(jar);

  // 1. GET prévio na página de login pra estabelecer sessão inicial (__goc_session__)
  const respGet = await client.get(PORTAL_URL);
  console.log("GET inicial - status:", respGet.status);

  // 2. Esse GET no favicon é o que faz o Tomcat gerar o JSESSIONID.
  //    Sem ele, o auth retorna 401 mesmo com usuário/senha corretos.
  const respFavicon = await client.get(`${PORTAL_URL}recurso`, {
    params: { aplicacao: "ALUNO_RESP", objeto: "FAVICON" },
  });
  console.log("GET favicon - status:", respFavicon.status);

  // Busca a chave pública e criptografa a senha, igual o front-end faz via JSEncrypt
  const pemChave = await obterChavePublica(client);
  const senhaCriptografada = criptografarSenha(SENHA, pemChave);

  // Payload precisa ser form-urlencoded, não JSON — por isso usamos URLSearchParams
  const payload = new URLSearchParams({
    username: USUARIO,
    password: senhaCriptografada,
    recaptchaResponse: "",
  });

  const headersPost = {
    "Content-Type": "application/x-www-form-urlencoded",
    Origin: "https://unipar.lyceum.com.br",
    Referer: PORTAL_URL,
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
    "Accept-Language-Portal": "pt_br",
    "X-Lyceum-Transacao": "https://unipar.lyceum.com.br/aluno/#/login",
    "X-Lyceum-Usuario": "null",
  };

  const resp = await client.post(LOGIN_URL, payload.toString(), {
    headers: headersPost,
  }).then((response) => {
    console.log("Status do POST auth:", response.status);
    return response;
  }).catch((error) => {
    console.error("Erro no POST auth:", error);
    throw error;
  });

  console.log("Status do POST auth:", resp.status);
  const cookiesAposPost = await jar.getCookies(LOGIN_URL);

  if (resp.status >= 400) {
    throw new Error(`Login falhou com status ${resp.status}`);
  }

  if (cookiesAposPost.length === 0) {
    throw new Error("Login falhou - nenhum cookie de sessão foi retornado");
  }

  return { client, jar };
}

async function salvarSessao(jar: CookieJar): Promise<void> {
  // tough-cookie tem serialização nativa via toJSON(), que preserva
  // domínio/path/expiração de cada cookie (mais completo que só name=value)
  const serializado = jar.toJSON();
  fs.writeFileSync(SESSION_FILE, JSON.stringify(serializado, null, 2));
}

async function carregarSessao(): Promise<{ client: AxiosInstance; jar: CookieJar } | null> {
  if (!fs.existsSync(SESSION_FILE)) {
    return null;
  }
  const bruto = fs.readFileSync(SESSION_FILE, "utf-8");
  const dados = JSON.parse(bruto);
  const jar = CookieJar.fromJSON(JSON.stringify(dados));
  const client = criarClienteComSessao(jar);
  return { client, jar };
}

async function sessaoValida(client: AxiosInstance): Promise<boolean> {
  try {
    const resp = await client.get(
      `${API_BASE}/pessoas/90508036/alunos/60010845/disciplinasBoletim`
    );
    return resp.status === 200;
  } catch {
    return false;
  }
}

async function obterSessao(USUARIO: string, SENHA: string): Promise<{ client: AxiosInstance; jar: CookieJar }> {
  const sessaoSalva = await carregarSessao();
  if (sessaoSalva && (await sessaoValida(sessaoSalva.client))) {
    console.log("Sessão reaproveitada.");
    return sessaoSalva;
  }

  console.log("Sessão expirada ou inexistente. Fazendo login...");
  const novaSessao = await fazerLogin(USUARIO, SENHA);
  await salvarSessao(novaSessao.jar);
  return novaSessao;
}

async function buscarDadosUsuario(client: AxiosInstance): Promise<unknown> {
  const resp = await client.get(`${API_BASE}/pessoas/90508036`);
  if (resp.status >= 400) {
    throw new Error(`Erro ao buscar dados do usuário: status ${resp.status}`);
  }
  return resp.data;
}

async function buscarNotas(client: AxiosInstance): Promise<unknown> {
  const resp = await client.get(
    `${API_BASE}/pessoas/90508036/alunos/60010845/disciplinasBoletim`
  );
  if (resp.status >= 400) {
    throw new Error(`Erro ao buscar notas: status ${resp.status}`);
  }
  return resp.data;
}

export function excluirSessao(): void {
  if (fs.existsSync(SESSION_FILE)) {
    fs.unlinkSync(SESSION_FILE); 
  }
}

/**
 * Equivalente ao returnData() do Python: ponto de entrada
 * usado por outras partes da aplicação (ex: uma API Express, um handler, etc.)
 */
export async function returnData(USUARIO: string, SENHA: string): Promise<unknown> {
  const { client } = await obterSessao(USUARIO, SENHA);
  return buscarNotas(client);
}

