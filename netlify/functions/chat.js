// Netlify Function: Claude API proxy with Supabase tool use
// Replaces ai-server.py /api/chat endpoint
 
const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const CLAUDE_MODEL = "claude-sonnet-4-20250514";
 
const SYSTEM_PROMPT = `あなたは「しろくま電力」の資材総合DBアシスタントです。購買チームの資材検索・比較・分析をサポートします。
 
## 重要ルール
- 回答は **プレーンテキスト（Markdown可）** で返す。HTMLタグは使わない。
- テーブルはMarkdown記法（| col1 | col2 |）で書く。
- 金額は「¥」と3桁カンマ区切り（例: ¥4,200,000）
- unit_priceがnull/0/未設定の資材は「要見積」と表記する
- DBに無い情報は「DBに未登録」と明示
- 推測は「推定」と明記
 
## DB構造（materialsテーブル 403品目）
id, product_name(品名), major_category(大分類), sub_category(小分類), maker(メーカー),
unit_price(単価), unit(単位), qty(数量), total_price(合計), supplier(仕入先),
estimate_date(見積日), estimate_no(見積番号), project(案件名), note(備考),
desc1(資材説明), desc2(用途), desc3(リードタイム), desc5(影響度), desc6(スペック詳細テーブル)
 
### desc6の重要性
desc6には「導体断面積」「定格電圧」「定格出力」「効率」「寸法」「重量」等のスペック情報がHTMLテーブルで格納されている。
比較時には必ずdesc6のスペック情報を参照し、比較前提を揃えること。
 
## ★最重要: 前提条件の確認ルール（比較・分析時）
資材の比較や価格差の分析を行う際は、**必ず以下の前提条件を先に確認・報告してから結論を出すこと**。
 
1. **単位（unit）の確認**: m, 式, 台, 本, 個, 組 など単位が異なる資材同士は直接比較不可
2. **定格電圧**: 600V, 1500V, 3.3kV, 6.6kV など電圧クラスが異なれば価格帯が全く異なる
3. **導体断面積(SQ)**: 5.5SQ, 60SQ, 150SQ, 250SQ, 400SQ など断面積が違えば直接比較不可
4. **製造元の区分**: 国内メーカー vs 海外メーカー（NINGBO KIBOR等）は通貨・単位・品質基準が異なる可能性あり
5. **案件・見積条件**: project(案件名)やestimate_date(見積日)が異なる場合、市況変動の影響あり
6. **「式」単位の除外**: unit=「式」は一式見積なので、単品比較からは除外する
 
### 比較回答の構成
1. まず「前提条件の整理」として、比較対象の単位・電圧・断面積・製造元等の違いを明示する
2. 前提が揃わない場合は「前提条件が異なるため直接比較できません」と明記し、可能な範囲で条件を揃えた比較を試みる
3. 同一条件（同電圧・同断面積・同単位）で比較できるペアのみ価格差を算出する
4. 結論を出す際は、何と何を比較した結果なのか条件を明示する
 
## 回答スタイル
- 最初に簡潔な要約（2-3行）
- 次に前提条件の整理（比較時は必須）
- 次にデータの分析・所見
- 必要に応じて注意点・推奨事項
- 長い表は作らない（データ表示はフロントエンドが担当。あなたは分析と要約に集中）
 
## ★おすすめ資材のマーキング
おすすめ・推奨する資材がある場合、回答の末尾に以下のタグを必ず付与すること（ユーザーには表示されない内部タグ）:
- 品名でマーク: <<RECOMMEND:品名>>
- 例: <<RECOMMEND:SUN2000-125KTL-JPH0>>
- 複数ある場合は複数タグを付ける: <<RECOMMEND:品名A>><<RECOMMEND:品名B>>
- このタグはフロントエンドがテーブル上でおすすめ資材を強調表示するために使用する
- おすすめがない質問（単純な一覧表示や統計）ではタグ不要
 
## 重要: ツール使用の効率化
- 1回の回答に使うツール呼び出しは最大3回までに抑える
- 必要なデータは可能な限り1-2回の検索で取得する
- 同じツールを何度も呼ばない。検索結果が十分なら、すぐに分析・回答に移る
- 比較分析の場合: まず両方のデータを取得し、前提条件を確認してから比較結果を出す`;
 
const TOOLS = [
  {
    name: "search_materials",
    description: "資材を検索。品名,カテゴリ,メーカー,仕入先等で部分一致検索。結果にはdesc1(説明)とdesc6(スペック詳細:電圧,断面積等)が含まれる。比較時はdesc6のスペックを必ず確認すること。",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "検索キーワード" },
        field: { type: "string", enum: ["product_name","major_category","sub_category","maker","supplier","project","all"], default: "all" },
        limit: { type: "integer", default: 30 }
      },
      required: ["query"]
    }
  },
  {
    name: "get_material_by_id",
    description: "IDで資材の全フィールドを取得",
    input_schema: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] }
  },
  {
    name: "get_category_list",
    description: "大分類の一覧と各件数を取得",
    input_schema: { type: "object", properties: {} }
  },
  {
    name: "get_materials_by_category",
    description: "指定カテゴリの資材一覧を取得",
    input_schema: {
      type: "object",
      properties: {
        category: { type: "string", description: "大分類名" },
        sort_by: { type: "string", enum: ["unit_price","product_name","maker"], default: "unit_price" },
        limit: { type: "integer", default: 100 }
      },
      required: ["category"]
    }
  },
  {
    name: "compare_materials",
    description: "2つの資材を比較。品名で指定。全フィールド(desc1,desc6含む)を返す。比較前にunit,電圧,断面積等の前提条件を確認すること。",
    input_schema: {
      type: "object",
      properties: { material_a: { type: "string" }, material_b: { type: "string" } },
      required: ["material_a", "material_b"]
    }
  },
  {
    name: "price_statistics",
    description: "指定カテゴリの価格統計（平均,最小,最大,中央値）",
    input_schema: { type: "object", properties: { category: { type: "string" } }, required: ["category"] }
  },
  {
    name: "get_suppliers",
    description: "仕入先一覧と取扱品目数・主要カテゴリ",
    input_schema: { type: "object", properties: {} }
  },
  {
    name: "top_by_price",
    description: "単価の高い順/安い順でランキング",
    input_schema: {
      type: "object",
      properties: {
        order: { type: "string", enum: ["desc","asc"], default: "desc" },
        limit: { type: "integer", default: 10 },
        category: { type: "string", description: "カテゴリ絞り込み(省略可)" }
      }
    }
  }
];
 
// === Supabase helper ===
async function sb(path) {
  const url = `${process.env.SUPABASE_URL}/rest/v1/${path}`;
  try {
    const res = await fetch(url, {
      headers: {
        apikey: process.env.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json",
      },
    });
    if (!res.ok) {
      const txt = await res.text();
      return { error: `HTTP ${res.status}: ${txt.slice(0, 200)}` };
    }
    return await res.json();
  } catch (e) {
    return { error: e.message };
  }
}
 
// === Tool implementations ===
const SEL = "select=id,product_name,major_category,sub_category,maker,unit_price,unit,qty,total_price,supplier,estimate_date,note,project,desc1,desc6";
 
async function searchMaterials(query, field = "all", limit = 30) {
  const q = encodeURIComponent(query);
  if (field === "all") {
    return sb(`materials?${SEL}&or=(product_name.ilike.*${q}*,major_category.ilike.*${q}*,sub_category.ilike.*${q}*,maker.ilike.*${q}*,supplier.ilike.*${q}*,note.ilike.*${q}*,desc1.ilike.*${q}*)&limit=${limit}&order=unit_price.desc.nullslast`);
  }
  return sb(`materials?${SEL}&${field}=ilike.*${q}*&limit=${limit}&order=unit_price.desc.nullslast`);
}
 
async function getMaterialById(id) {
  return sb(`materials?id=eq.${id}&select=*`);
}
 
async function getCategoryList() {
  const data = await sb("materials?select=major_category&order=major_category");
  if (Array.isArray(data)) {
    const cats = {};
    data.forEach(r => { const c = r.major_category || "未分類"; cats[c] = (cats[c] || 0) + 1; });
    return Object.entries(cats).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ category: k, count: v }));
  }
  return data;
}
 
async function getMaterialsByCategory(category, sortBy = "unit_price", limit = 100) {
  const q = encodeURIComponent(category);
  return sb(`materials?${SEL}&major_category=ilike.*${q}*&order=${sortBy}.asc.nullslast&limit=${limit}`);
}
 
async function findMat(ident) {
  const id = parseInt(ident);
  if (!isNaN(id)) {
    const r = await sb(`materials?id=eq.${id}&select=*`);
    if (Array.isArray(r) && r.length) return r;
  }
  const q = encodeURIComponent(ident);
  return sb(`materials?product_name=ilike.*${q}*&select=*&limit=5`);
}
 
async function compareMaterials(a, b) {
  const [ra, rb] = await Promise.all([findMat(a), findMat(b)]);
  return {
    material_a: Array.isArray(ra) && ra.length ? ra[0] : null,
    material_b: Array.isArray(rb) && rb.length ? rb[0] : null,
  };
}
 
async function priceStatistics(category) {
  const q = encodeURIComponent(category);
  const data = await sb(`materials?major_category=ilike.*${q}*&select=product_name,unit_price,unit,maker,supplier,desc1,desc6&order=unit_price.asc.nullslast`);
  if (Array.isArray(data) && data.length) {
    const prices = data.filter(r => r.unit_price && r.unit_price > 0).map(r => r.unit_price).sort((a, b) => a - b);
    if (prices.length) {
      const n = prices.length;
      return {
        category, count: data.length, price_count: n,
        min: Math.min(...prices), max: Math.max(...prices),
        average: Math.round(prices.reduce((s, p) => s + p, 0) / n),
        median: n % 2 ? prices[Math.floor(n / 2)] : (prices[n / 2 - 1] + prices[n / 2]) / 2,
        items: data,
      };
    }
  }
  return { category, count: 0, message: "該当データなし" };
}
 
async function getSuppliers() {
  const data = await sb("materials?select=supplier,major_category,product_name&order=supplier");
  if (Array.isArray(data)) {
    const sups = {};
    data.forEach(r => {
      const s = r.supplier || "不明";
      if (!sups[s]) sups[s] = { count: 0, cats: {} };
      sups[s].count++;
      const c = r.major_category || "未分類";
      sups[s].cats[c] = (sups[s].cats[c] || 0) + 1;
    });
    return Object.entries(sups)
      .sort((a, b) => b[1].count - a[1].count)
      .map(([name, info]) => ({
        supplier: name, total: info.count,
        top_categories: Object.entries(info.cats).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c, n]) => ({ category: c, count: n })),
      }));
  }
  return data;
}
 
async function topByPrice(order = "desc", limit = 10, category = null) {
  const d = order === "desc" ? "desc" : "asc";
  let p = `materials?select=product_name,major_category,maker,unit_price,supplier,unit,desc1,desc6&unit_price=not.is.null&unit_price=gt.0&order=unit_price.${d}.nullslast&limit=${limit}`;
  if (category) p += `&major_category=ilike.*${encodeURIComponent(category)}*`;
  return sb(p);
}
 
async function executeTool(name, input) {
  switch (name) {
    case "search_materials": return searchMaterials(input.query || "", input.field || "all", input.limit || 30);
    case "get_material_by_id": return getMaterialById(input.id || 0);
    case "get_category_list": return getCategoryList();
    case "get_materials_by_category": return getMaterialsByCategory(input.category || "", input.sort_by || "unit_price", input.limit || 100);
    case "compare_materials": return compareMaterials(input.material_a || "", input.material_b || "");
    case "price_statistics": return priceStatistics(input.category || "");
    case "get_suppliers": return getSuppliers();
    case "top_by_price": return topByPrice(input.order || "desc", input.limit || 10, input.category);
    default: return { error: `Unknown tool: ${name}` };
  }
}
 
// === Claude API call with tool use loop ===
const PRICE_HIDDEN_ADDENDUM = `
 
## ★★最重要: 価格情報の非表示ルール
このユーザーには価格閲覧権限がありません。以下を厳守すること:
- unit_price, total_price, 金額, 単価, 価格, コスト等の数値は一切回答に含めない
- 「¥」「円」「万円」等の金額表記を使わない
- 「最安」「最高額」「価格差」「コスパ」等の価格比較表現を使わない
- 価格に関する質問には「価格情報の閲覧権限が必要です。管理者にお問い合わせください。」と回答する
- スペック、メーカー、用途、リードタイム等の非価格情報は通常通り回答してよい`;
 
async function callClaude(messages, maxIter = 10, showPrice = true) {
  const collectedData = [];
  const systemPrompt = showPrice ? SYSTEM_PROMPT : (SYSTEM_PROMPT + PRICE_HIDDEN_ADDENDUM);
 
  for (let i = 0; i < maxIter; i++) {
    const res = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 4096,
        system: systemPrompt,
        tools: TOOLS,
        messages,
      }),
    });
 
    if (!res.ok) {
      const txt = await res.text();
      return { error: `Claude API error ${res.status}: ${txt.slice(0, 500)}` };
    }
 
    const result = await res.json();
    const content = result.content || [];
 
    if (result.stop_reason === "tool_use") {
      messages.push({ role: "assistant", content });
      const toolResults = [];
 
      for (const block of content) {
        if (block.type === "tool_use") {
          console.log(`[Tool] ${block.name}(${JSON.stringify(block.input).slice(0, 80)})`);
          const output = await executeTool(block.name, block.input);
          if (Array.isArray(output)) collectedData.push(...output);
          else if (output && output.items) collectedData.push(...output.items);
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: JSON.stringify(output).slice(0, 12000),
          });
        }
      }
      messages.push({ role: "user", content: toolResults });
      continue;
    }
 
    const text = content.filter(b => b.type === "text").map(b => b.text).join("\n");
    return { response: text, data: collectedData, usage: result.usage || {} };
  }
 
  return { error: "Max iterations exceeded" };
}
 
// === Handler ===
exports.handler = async (event) => {
  // CORS
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" }, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }
 
  try {
    const body = JSON.parse(event.body);
    const msg = body.message || "";
    const hist = body.history || [];
    const showPrice = body.showPrice !== false; // デフォルトtrue、明示的にfalseの場合のみ非表示
    if (!msg) return { statusCode: 400, body: JSON.stringify({ error: "empty message" }) };
 
    const messages = hist.slice(-8).map(h => ({ role: h.role, content: h.content }));
    messages.push({ role: "user", content: msg });
 
    const result = await callClaude(messages, 10, showPrice);
 
    if (result.error) {
      return {
        statusCode: 500,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ error: result.error }),
      };
    }
 
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ response: result.response, data: result.data, usage: result.usage }),
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ error: e.message }),
    };
  }
};
