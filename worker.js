/**
 * 물건조사서 — Cloudflare Workers (정적 에셋 포함) 진입 파일
 * ------------------------------------------------------------------
 * V-World는 Cloudflare 엣지에서 차단(520/502)되므로 브라우저에서 직접 호출합니다.
 * 이 워커는 (1) 공공데이터포털(건축물대장·실거래가)만 프록시하고,
 *           (2) index.html을 서빙할 때 {{VWORLD_KEY}} 자리에 키를 주입합니다.
 *
 * 키는 워커 → Settings → Variables and Secrets 에 등록:
 *   VWORLD_KEY        : V-World 인증키 (HTML에 주입되어 브라우저가 사용)
 *   DATA_GO_KR_KEY    : 공공데이터포털 인증키 (Decoding 키 권장)
 *
 * 라우트:
 *   GET /api/registry?pnu=...   → { building, recent_trades }
 *   그 외 경로                   → public/ 정적 파일 (HTML은 키 주입 후 서빙)s
 */

const DATAGO = "http://apis.data.go.kr/1613000";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

    try {
      if (url.pathname === "/api/registry") return await handleRegistry(url, env);
      return await serveAsset(req, env);   // 정적 파일 + HTML 키 주입
    } catch (e) {
      return json({ error: String(e && e.message || e) }, 500);
    }
  },
};

/* ─────────────── 정적 파일 서빙 (HTML 키 주입) ─────────────── */
async function serveAsset(req, env) {
  const res = await env.ASSETS.fetch(req);
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("text/html")) return res;
  let html = await res.text();
  html = html.split("{{VWORLD_KEY}}").join(env.VWORLD_KEY || "");
  const headers = new Headers(res.headers);
  return new Response(html, { status: res.status, headers });
}

/* ─────────────── /api/registry ─────────────── */
async function handleRegistry(url, env) {
  const pnu = (url.searchParams.get("pnu") || "").trim();
  if (pnu.length !== 19) return json({ error: "pnu(19자리)가 필요합니다." }, 400);
  const parts = parsePNU(pnu);

  const [building, recent_trades] = await Promise.all([
    buildingInfo(parts, env).catch(() => ({})),
    recentTrades(parts.sigungu_cd, env).catch(() => []),
  ]);
  return json({ building: building || {}, recent_trades });
}

/* ─────────────── 건축물대장 ─────────────── */
async function buildingInfo(parts, env) {
  const q = new URLSearchParams({
    serviceKey: env.DATA_GO_KR_KEY,
    sigunguCd: parts.sigungu_cd, bjdongCd: parts.bjdong_cd,
    platGbCd: parts.plat_gb_cd, bun: parts.bun, ji: parts.ji,
    numOfRows: "10", pageNo: "1", _type: "json",
  }); 
  const r = await fetch(`${DATAGO}/BldRgstService_v2/getBrTitleInfo?${q}`);
  const items = pickItems(await r.json().catch(() => null));
  if (!items.length) return {};
  const it = items.reduce((a, b) => (num(b.totArea) || 0) > (num(a.totArea) || 0) ? b : a);
  return {
    main_use: it.mainPurpsCdNm, structure: it.strctCdNm,
    ground_floors: int(it.grndFlrCnt), underground_floors: int(it.ugrndFlrCnt),
    total_area_m2: num(it.totArea),
    building_coverage: num(it.bcRat), floor_area_ratio: num(it.vlRat),
    approval_date: fmtDate(it.useAprDay), households: int(it.hhldCnt),
  };
}

/* ─────────────── 실거래가 ─────────────── */
async function recentTrades(sigunguCd, env, months = 3, limit = 5) {
  const out = [];
  for (const ym of recentMonths(months)) {
    const q = new URLSearchParams({
      serviceKey: env.DATA_GO_KR_KEY, LAWD_CD: sigunguCd, DEAL_YMD: ym,
      numOfRows: "100", pageNo: "1", _type: "json",
    });
    const r = await fetch(`${DATAGO}/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade?${q}`);
    for (const it of pickItems(await r.json().catch(() => null))) {
      const y = String(it.dealYear || "").trim();
      const m = String(it.dealMonth || "").trim().padStart(2, "0");
      const d = String(it.dealDay || "").trim().padStart(2, "0");
      const price = String(it.dealAmount || "").replace(/,/g, "").trim();
      out.push({
        deal_date: y ? `${y}-${m}-${d}` : null,
        price_manwon: /^\d+$/.test(price) ? +price : null,
        area_m2: num(it.excluUseAr), floor: int(it.floor),
        name: (it.aptNm || "").trim() || null,
      });
    }
  }
  out.sort((a, b) => (b.deal_date || "").localeCompare(a.deal_date || ""));
  return out.slice(0, limit);
}

/* ─────────────── 유틸 ─────────────── */
function parsePNU(pnu) {
  pnu = String(pnu).trim();
  if (pnu.length !== 19) throw new Error(`PNU 19자리 아님: ${pnu}`);
  return {
    pnu, sigungu_cd: pnu.slice(0, 5), bjdong_cd: pnu.slice(5, 10),
    plat_gb_cd: pnu[10] === "2" ? "1" : "0",
    bun: pnu.slice(11, 15), ji: pnu.slice(15, 19),
  };
}
function pickItems(payload) {
  const it = payload?.response?.body?.items?.item;
  if (!it) return [];
  return Array.isArray(it) ? it : [it];
}
function recentMonths(n) {
  const out = []; const t = new Date();
  let y = t.getFullYear(), m = t.getMonth() + 1;
  for (let i = 0; i < n; i++) { out.push(`${y}${String(m).padStart(2, "0")}`); if (--m === 0) { m = 12; y--; } }
  return out;
}
const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
const int = v => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; };
function fmtDate(v) {
  const s = String(v || "").trim();
  return /^\d{8}$/.test(s) ? `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}` : (s || null);
}
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status, headers: { "Content-Type": "application/json; charset=utf-8", ...CORS },
  });
}
