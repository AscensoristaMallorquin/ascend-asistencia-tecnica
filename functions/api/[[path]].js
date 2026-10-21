const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
const STOP = new Set(["error", "errores", "codigo", "código", "falla", "fallo", "maniobra", "manual", "ascensor", "ascensores", "que", "qué", "significa", "para", "del", "con", "una", "como", "por", "las", "los", "the", "what", "does"]);

const json = (value, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
function b64url(bytes) { return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); }
function pemBytes(pem) { return Uint8Array.from(atob(pem.replace(/-----[^-]+-----/g, "").replace(/\s/g, "")), c => c.charCodeAt(0)); }
async function driveToken(env) {
  if (!env.GOOGLE_DRIVE_FOLDER_ID || !env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY) {
    throw Object.assign(new Error("Google Drive todavía no está configurado completamente."), { status: 503 });
  }
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const claim = b64url(new TextEncoder().encode(JSON.stringify({ iss: env.GOOGLE_SERVICE_ACCOUNT_EMAIL, scope: DRIVE_SCOPE, aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 })));
  const unsigned = `${header}.${claim}`;
  const key = await crypto.subtle.importKey("pkcs8", pemBytes(env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const signature = b64url(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned)));
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${signature}` }) });
  if (!response.ok) throw new Error("Google Drive no está configurado correctamente.");
  return (await response.json()).access_token;
}
async function google(token, url) {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error("No se pudo consultar Google Drive.");
  return response;
}
async function userFor(request, env) {
  const token = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw Object.assign(new Error("Inicia sesión para continuar."), { status: 401 });
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(env.FIREBASE_API_KEY)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken: token }) });
  const data = await response.json();
  const identity = data.users?.[0];
  if (!response.ok || !identity?.emailVerified) throw Object.assign(new Error("La sesión no es válida o Google no ha confirmado el correo."), { status: 401 });
  const admin = identity.email.toLowerCase() === env.ASCEND_ADMIN_EMAIL.toLowerCase();
  await env.DB.prepare("INSERT OR IGNORE INTO users (uid,email,read,download,admin) VALUES (?,?,0,0,0)").bind(identity.localId, identity.email.toLowerCase()).run();
  if (admin) await env.DB.prepare("UPDATE users SET email=?,read=1,download=1,admin=1 WHERE uid=?").bind(identity.email.toLowerCase(), identity.localId).run();
  const grant = await env.DB.prepare("SELECT read,download FROM users WHERE uid=?").bind(identity.localId).first();
  return { uid: identity.localId, email: identity.email.toLowerCase(), admin, read: admin || !!grant?.read, download: admin || !!grant?.download };
}
function admin(user) { if (!user.admin) throw Object.assign(new Error("Solo la administradora puede realizar esta acción."), { status: 403 }); }
function readable(user) { if (!user.read) throw Object.assign(new Error("Tu cuenta aún no tiene permiso de lectura. Pide acceso a la administradora."), { status: 403 }); }
async function driveFiles(env, search = "") {
  const token = await driveToken(env);
  const types = "(mimeType='application/pdf' or mimeType='application/vnd.openxmlformats-officedocument.wordprocessingml.document' or mimeType='application/msword' or mimeType='text/plain' or mimeType='application/vnd.google-apps.document')";
  const clauses = [`'${env.GOOGLE_DRIVE_FOLDER_ID}' in parents`, "trashed=false", types];
  if (search) for (const term of search) clauses.push(`fullText contains '${term.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`);
  const query = new URLSearchParams({ q: clauses.join(" and "), pageSize: "100", orderBy: "modifiedTime desc", fields: "files(id,name,mimeType,size,modifiedTime,parents)" });
  const files = (await (await google(token, `https://www.googleapis.com/drive/v3/files?${query}`)).json()).files || [];
  return { token, files };
}

export async function onRequest({ request, env, params }) {
  try {
    const url = new URL(request.url), path = (params.path || []).join("/");
    if (path === "config" && request.method === "GET") return json({ auth_mode: "firebase", firebase: { apiKey: env.FIREBASE_API_KEY, authDomain: env.FIREBASE_AUTH_DOMAIN, projectId: env.FIREBASE_PROJECT_ID, appId: env.FIREBASE_APP_ID } });
    if (path === "health" && request.method === "GET") return json({ ok: true });
    if (path === "status" && request.method === "GET") {
      const driveConfigured = !!(env.GOOGLE_DRIVE_FOLDER_ID && env.GOOGLE_SERVICE_ACCOUNT_EMAIL && env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY);
      return json({ drive_configured: driveConfigured, drive_connected: driveConfigured, domains: [], sources: [] });
    }

    const user = await userFor(request, env);
    if (path === "account" && request.method === "GET") return json({ user: { uid: user.uid, email: user.email, admin: user.admin }, permissions: user });
    if (path === "library" && request.method === "GET") {
      readable(user);
      const { results } = await env.DB.prepare("SELECT id,name,mimeType FROM manuals ORDER BY name COLLATE NOCASE").all();
      return json({ manuals: results });
    }
    if (path === "admin/users" && request.method === "GET") {
      admin(user);
      const { results } = await env.DB.prepare("SELECT uid,email,read,download,admin FROM users ORDER BY email").all();
      return json({ users: results.map(x => ({ ...x, read: !!x.read, download: !!x.download, admin: !!x.admin })) });
    }
    if (path === "admin/users/permissions" && request.method === "POST") {
      admin(user); const data = await request.json();
      const target = await env.DB.prepare("SELECT email,admin FROM users WHERE uid=?").bind(String(data.uid || "")).first();
      if (!target) return json({ error: "Ese usuario aún no ha iniciado sesión en Ascend." }, 400);
      if (target.admin) return json({ error: "No se pueden cambiar permisos de la cuenta administradora." }, 400);
      await env.DB.prepare("UPDATE users SET read=?,download=? WHERE uid=?").bind(data.read ? 1 : 0, data.read && data.download ? 1 : 0, String(data.uid)).run();
      return json({ ok: true });
    }
    if (path === "google/files" && request.method === "GET") {
      admin(user); const { files } = await driveFiles(env); const { results } = await env.DB.prepare("SELECT id FROM manuals").all(); const imported = new Set(results.map(x => x.id));
      return json({ files: files.map(f => ({ id: f.id, name: f.name, mimeType: f.mimeType, imported: imported.has(f.id) })) });
    }
    if (path === "search" && request.method === "POST") {
      readable(user); const question = String((await request.json()).message || "").trim();
      const raw = [...new Set(question.match(/[\p{L}\p{N}_-]{2,50}/gu) || [])];
      const terms = raw.filter(t => (t.length >= 3 && !STOP.has(t.toLowerCase())) || (/^\d{2,}$/.test(t))).slice(0, 8);
      if (!terms.length) return json({ error: "Escribe al menos una palabra o código para buscar." }, 400);
      const { files } = await driveFiles(env, terms); const { results } = await env.DB.prepare("SELECT id FROM manuals").all(); const allowed = new Set(results.map(x => x.id));
      const matches = files.filter(f => allowed.has(f.id)).map(f => ({ ...f, name_match: terms.filter(t => f.name.toLowerCase().includes(t.toLowerCase())).length })).sort((a,b)=>b.name_match-a.name_match || (b.modifiedTime||"").localeCompare(a.modifiedTime||""));
      return json({ query: question, terms, files: matches.slice(0,30).map(f=>({ id:f.id,name:f.name,webViewLink:`/api/manual/${encodeURIComponent(f.id)}`})), message: "La búsqueda localiza documentos que pueden contener esos términos; no muestra una página ni interpreta el código. Confirma el resultado y la revisión en el manual original." });
    }
    if (path === "admin/import" && request.method === "POST") {
      admin(user); const id = String((await request.json()).id || "");
      if (!/^[\w-]{1,160}$/.test(id)) return json({ error: "Selecciona un documento válido de Drive." }, 400);
      const token = await driveToken(env), meta = await (await google(token, `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?fields=id,name,mimeType,size,trashed,parents`)).json();
      const supported = ["application/pdf","application/vnd.openxmlformats-officedocument.wordprocessingml.document","application/msword","text/plain","application/vnd.google-apps.document"];
      if (meta.trashed || !meta.parents?.includes(env.GOOGLE_DRIVE_FOLDER_ID) || !supported.includes(meta.mimeType)) return json({ error: "El archivo debe ser compatible y estar directamente en la carpeta autorizada." }, 400);
      const isDoc = meta.mimeType === "application/vnd.google-apps.document", type = isDoc ? "application/pdf" : meta.mimeType;
      const mediaUrl = isDoc ? `https://www.googleapis.com/drive/v3/files/${id}/export?mimeType=application/pdf` : `https://www.googleapis.com/drive/v3/files/${id}?alt=media`;
      const response = await google(token, mediaUrl), raw = await response.arrayBuffer();
      if (raw.byteLength > 40 * 1024 * 1024) return json({ error: "El archivo supera el máximo de 40 MB por manual." }, 400);
      const name = meta.name + (isDoc && !meta.name.toLowerCase().endsWith(".pdf") ? ".pdf" : "");
      await env.FILES.put(`manuals/${id}`, raw, { httpMetadata: { contentType: type } });
      await env.DB.prepare("INSERT OR REPLACE INTO manuals(id,name,mimeType,object) VALUES(?,?,?,?)").bind(id, name, type, `manuals/${id}`).run();
      return json({ ok: true, id, name });
    }
    if (path.startsWith("manual/") && request.method === "GET") {
      readable(user); const id = decodeURIComponent(path.slice("manual/".length));
      if (!/^[\w-]{1,160}$/.test(id)) return json({ error: "Identificador de manual inválido." }, 400);
      const wantsDownload = url.searchParams.has("download"); if (wantsDownload && !user.download) return json({ error: "Tu cuenta no tiene permiso para descargar manuales." }, 403);
      const item = await env.DB.prepare("SELECT name,mimeType,object FROM manuals WHERE id=?").bind(id).first();
      if (!item) return json({ error: "Manual no encontrado." }, 404);
      const object = await env.FILES.get(item.object); if (!object) return json({ error: "Manual no encontrado." }, 404);
      const safeName = item.name.replace(/[\r\n"\\]/g, "_");
      return new Response(object.body, { headers: { "Content-Type": item.mimeType, "Content-Disposition": `${wantsDownload ? "attachment" : "inline"}; filename="${safeName}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
    }
    return json({ error: "Ruta no encontrada." }, 404);
  } catch (error) {
    return json({ error: error.message || "No se pudo completar la solicitud." }, error.status || 500);
  }
}
