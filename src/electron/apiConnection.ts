import axios, { type AxiosInstance } from "axios";
import { wrapper } from "axios-cookiejar-support";
import { CookieJar } from "tough-cookie";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import * as crypto from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORTAL_URL = "https://unipar.lyceum.com.br/aluno/";
const LOGIN_URL = "https://unipar.lyceum.com.br/aluno/auth";
const API_BASE = "https://unipar.lyceum.com.br/aluno/apix";
const PUBLIC_KEY_URL = "https://unipar.lyceum.com.br/aluno/config-properties/public-key";
const SESSION_FILE = path.resolve(__dirname, "session.json");

interface UserInfo {
  id: number | string;
  [key: string]: unknown;
}

interface Sessao {
  client: AxiosInstance;
  jar: CookieJar;
  userInfo: UserInfo;
}

/**
 * CACHE EM MEMÓRIA
 * Essa variável vive no escopo do módulo — como o processo principal do
 * Electron é um processo Node de longa duração (fica aberto enquanto o
 * app está aberto), ela funciona como um "singleton" natural: uma vez
 * preenchida, todas as chamadas seguintes (de qualquer parte do app que
 * importar esse módulo) reaproveitam o mesmo valor, sem tocar disco ou
 * rede de novo.
 *
 * Ela é reiniciada (volta a `null`) só quando o processo principal reinicia
 * de verdade (o usuário fecha e abre o app), porque é assim que módulos
 * ES/CommonJS funcionam: o estado deles vive só enquanto o processo existe.
 */
let sessaoEmMemoria: Sessao | null = null;

/**
 * Cria um client axios com um cookie jar próprio.
 */
function criarClienteComSessao(jar: CookieJar): AxiosInstance {
  return wrapper(
    axios.create({
      jar,
      withCredentials: true,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      },
      validateStatus: () => true,
    })
  );
}

async function obterChavePublica(client: AxiosInstance): Promise<string> {
  const resp = await client.get(PUBLIC_KEY_URL);
  const pemBruto = String(resp.data).trim();
  return formatarPem(pemBruto);
}

function formatarPem(pemBruto: string): string {
  const header = "-----BEGIN PUBLIC KEY-----";
  const footer = "-----END PUBLIC KEY-----";
  const corpo = pemBruto.replace(header, "").replace(footer, "").trim();
  const linhas = corpo.match(/.{1,64}/g) ?? [];
  return `${header}\n${linhas.join("\n")}\n${footer}\n`;
}

function criptografarSenha(senhaTextoPuro: string, pemChavePublica: string): string {
  const bufferSenha = Buffer.from(senhaTextoPuro, "utf-8");
  const cifrado = crypto.publicEncrypt(
    { key: pemChavePublica, padding: crypto.constants.RSA_PKCS1_PADDING },
    bufferSenha
  );
  return cifrado.toString("base64");
}

/**
 * Busca um cookie pelo NOME em vez de por posição no array.
 * A ordem que o servidor manda os Set-Cookie não é garantida ser sempre
 * a mesma — depender de `cookiesAposPost[1]` funciona até o dia em que
 * o servidor mudar a ordem (ou adicionar/remover um cookie) e quebrar
 * silenciosamente, sem erro nenhum, só pegando o cookie errado.
 */
async function buscarCookiePorNome(
  jar: CookieJar,
  url: string,
  nome: string
): Promise<string | null> {
  const cookies = await jar.getCookies(url);
  const cookie = cookies.find((c) => c.key === nome);
  return cookie ? cookie.value : null;
}

function decodificarUserData(valorCookie: string): UserInfo {
  return JSON.parse(Buffer.from(valorCookie, "base64").toString("utf-8"));
}

async function fazerLogin(usuario: string, senha: string): Promise<Sessao> {
  const jar = new CookieJar();
  const client = criarClienteComSessao(jar);

  const respGet = await client.get(PORTAL_URL);
  console.log("GET inicial - status:", respGet.status);

  const respFavicon = await client.get(`${PORTAL_URL}recurso`, {
    params: { aplicacao: "ALUNO_RESP", objeto: "FAVICON" },
  });
  console.log("GET favicon - status:", respFavicon.status);

  const pemChave = await obterChavePublica(client);
  const senhaCriptografada = criptografarSenha(senha, pemChave);

  const payload = new URLSearchParams({
    username: usuario,
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

  const resp = await client.post(LOGIN_URL, payload.toString(), { headers: headersPost });
  console.log("Status do POST auth:", resp.status);

  if (resp.status >= 400) {
    throw new Error(`Login falhou com status ${resp.status}`);
  }

  const userDataCookie = await buscarCookiePorNome(jar, LOGIN_URL, "user-data");
  if (!userDataCookie) {
    throw new Error("Login falhou - cookie 'user-data' não foi retornado");
  }

  const userInfo = decodificarUserData(userDataCookie);
  return { client, jar, userInfo };
}

/**
 * Persiste a sessão em disco (pra sobreviver ao fechamento do app),
 * E atualiza o cache em memória ao mesmo tempo — assim as duas fontes
 * ficam sempre sincronizadas em vez de você ter que lembrar de atualizar
 * as duas em lugares diferentes do código.
 */
function salvarSessao(sessao: Sessao): void {
  const serializado = sessao.jar.toJSON();
  fs.writeFileSync(
    SESSION_FILE,
    JSON.stringify({ cookies: serializado, userInfo: sessao.userInfo }, null, 2)
  );
  sessaoEmMemoria = sessao;
}

/**
 * Só lê o arquivo se realmente não tiver nada em memória ainda
 * (ex: logo depois do app abrir). Depois da primeira leitura,
 * essa função nunca mais é chamada até o processo reiniciar.
 */
function carregarSessaoDoDisco(): Sessao | null {
  if (!fs.existsSync(SESSION_FILE)) {
    return null;
  }
  const bruto = fs.readFileSync(SESSION_FILE, "utf-8");
  const dados = JSON.parse(bruto);
  const jar = CookieJar.fromJSON(JSON.stringify(dados.cookies));
  const client = criarClienteComSessao(jar);
  // dados.userInfo já é um objeto (foi serializado como objeto, não como string
  // dentro do JSON) — não precisa de um segundo JSON.parse aqui.
  return { client, jar, userInfo: dados.userInfo };
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

/**
 * Ponto central de acesso à sessão. Ordem de prioridade:
 * 1. Memória (mais rápido, nenhuma I/O)
 * 2. Disco (só na primeira chamada depois de abrir o app)
 * 3. Login novo (só se as anteriores falharem ou não existirem)
 */
async function obterSessao(usuario: string, senha: string): Promise<Sessao> {
  if (sessaoEmMemoria && (await sessaoValida(sessaoEmMemoria.client))) {
    console.log("Sessão reaproveitada (memória).");
    return sessaoEmMemoria;
  }

  const sessaoDoDisco = carregarSessaoDoDisco();
  if (sessaoDoDisco && (await sessaoValida(sessaoDoDisco.client))) {
    console.log("Sessão reaproveitada (disco) — carregando pra memória.");
    sessaoEmMemoria = sessaoDoDisco;
    return sessaoDoDisco;
  }

  console.log("Sessão expirada ou inexistente. Fazendo login...");
  const novaSessao = await fazerLogin(usuario, senha);
  salvarSessao(novaSessao); // já atualiza a memória também
  return novaSessao;
}

async function buscarDadosUsuario(client: AxiosInstance, userInfo: UserInfo): Promise<unknown> {
  const resp = await client.get(`${API_BASE}/api/rest/alunos/user/${userInfo.id}`);
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
  sessaoEmMemoria = null; // limpa a memória também, não só o disco
  if (fs.existsSync(SESSION_FILE)) {
    fs.unlinkSync(SESSION_FILE);
  }
}

export function obterUsuarioAtual(): UserInfo | null {
  return sessaoEmMemoria?.userInfo ?? null;
}

export async function returnData(usuario: string, senha: string): Promise<unknown> {
  const { client, userInfo } = await obterSessao(usuario, senha);
  return buscarDadosUsuario(client, userInfo);
}

export async function returnNotas(usuario: string, senha: string): Promise<unknown> {
  const { client } = await obterSessao(usuario, senha);
  return buscarNotas(client);
}