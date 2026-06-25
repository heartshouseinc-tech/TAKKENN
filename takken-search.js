/**
 * takken-search.js v2
 * 宅建達人 — Gemini過去問収集エンジン（方法A〜E全対応）+ 3回深掘り
 * ペットっち方式：window._FUNCTIONS_URL / X-Access-Key 参照
 */

// ============================================================
//  Gemini基本呼び出し（テキスト）
// ============================================================
async function tkCallGemini(prompt, useSearch = false) {
  const url = window._FUNCTIONS_URL;
  if (!url) throw new Error('Functions URL未設定');
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-access-key': 'HeartsHouse2026Key' },
    body: JSON.stringify({ model: 'gemini-2.5-flash', prompt, mode: 'normal', useSearch: !!useSearch })
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const d = await r.json();
  return d?.data?.text || d?.candidates?.[0]?.content?.parts?.[0]?.text || d?.text || '応答なし';
}

// ============================================================
//  Gemini multimodal呼び出し（PDF・画像対応）
// ============================================================
async function tkCallGeminiMultimodal(prompt, mediaContents = []) {
  const url = window._FUNCTIONS_URL;
  if (!url) throw new Error('Functions URL未設定');
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-access-key': 'HeartsHouse2026Key' },
    body: JSON.stringify({
      model: 'gemini-2.5-flash',
      mode: 'normal',
      prompt,
      mediaContents,
      useSearch: false
    })
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const d = await r.json();
  return d?.data?.text || d?.candidates?.[0]?.content?.parts?.[0]?.text || d?.text || '応答なし';
}

// ============================================================
//  JSONパース共通（```json囲いも除去）
// ============================================================
function tkParseJSON(raw) {
  try {
    const clean = raw.replace(/```json\s*/g,'').replace(/```\s*/g,'').trim();
    const m = clean.match(/(\[[\s\S]+\]|\{[\s\S]+\})/);
    if (m) return JSON.parse(m[1]);
  } catch(e) {}
  return null;
}

// ============================================================
//  宅建専門システムプロンプト
// ============================================================
const TAKKEN_SYSTEM = `あなたは宅地建物取引士（宅建士）試験の専門家AIです。
【専門領域】
権利関係：民法・借地借家法・区分所有法・不動産登記法
宅建業法：免許・宅建士登録・重要事項説明・37条書面・報酬計算・8種制限・監督処分
法令上の制限：都市計画法・建築基準法・農地法・国土利用計画法・土地区画整理法
税・その他：固定資産税・不動産取得税・印紙税・登録免許税・所得税・不動産鑑定評価
【回答ルール】
1. 法令条文番号・判例を必ず明示する
2. 具体的な数値・期間・要件を整理して説明する
3. 宅建試験のひっかけポイントも解説する
4. 最新の法改正はGoogle検索で確認して回答する
5. 日本語で簡潔・丁寧に回答する`;

const JSON_FORMAT = `以下のJSON配列形式のみで回答してください（前後のテキスト・\`\`\`不要）：
[{
  "year": 年度(数値),
  "no": 問番号(数値),
  "category": "権利関係|宅建業法|法令上の制限|税・その他",
  "question": "問題文全文",
  "choices": {"1":"肢1全文","2":"肢2全文","3":"肢3全文","4":"肢4全文"},
  "answer": 正解番号(1〜4の数値),
  "explanation": "解説（法令条文番号・ひっかけポイント含む）",
  "keywords": ["キーワード1","キーワード2"]
}]`;

// ============================================================
//  方法B：年度一括収集（1回のAPI呼び出しで50問）
// ============================================================
async function tkCollectByYear(year, onProgress) {
  onProgress('start', 0, 1, year + '年 全50問を一括検索中...');
  const prompt = TAKKEN_SYSTEM + '\n\n'
    + 'Google検索で宅建試験' + year + '年（' + toWareki(year) + '）の本試験問題を調べてください。\n'
    + '問1〜問50の全問題を以下のJSON配列で返してください。\n'
    + '正解番号は複数ソースで確認して正確に記載してください。\n\n'
    + JSON_FORMAT;
  const raw = await tkCallGemini(prompt, true);
  onProgress('parsing', 0, 1, 'JSONを解析中...');
  const questions = tkParseJSON(raw);
  if (!questions || !Array.isArray(questions)) throw new Error('JSON解析失敗。再試行してください。');
  onProgress('done', questions.length, questions.length, '✅ ' + questions.length + '問を取得しました');
  return questions.map(q => ({ ...q, year: Number(year), source: 'gemini_bulk' }));
}

// ============================================================
//  方法C：3回深掘り収集（1問を3回確認・高品質）
// ============================================================
async function tkCollectDeep(year, no, onProgress) {
  onProgress('step1', 0, 3, year + '年 問' + no + ' STEP1：問題文・選択肢を取得中...');

  // STEP1：問題文・選択肢取得
  const s1 = await tkCallGemini(
    TAKKEN_SYSTEM + '\n\n'
    + 'Google検索で宅建試験' + year + '年 問' + no + 'の問題文と選択肢1〜4を調べてください。\n'
    + '以下のJSON形式で回答してください（1問のみ・配列不要）：\n'
    + '{"year":' + year + ',"no":' + no + ',"category":"分野","question":"問題文","choices":{"1":"","2":"","3":"","4":""}}',
    true
  );
  const q1 = tkParseJSON(s1);
  if (!q1) throw new Error('STEP1失敗');

  onProgress('step2', 1, 3, year + '年 問' + no + ' STEP2：正解番号を複数ソースで検証中...');

  // STEP2：正解番号を複数ソースで確認
  const s2 = await tkCallGemini(
    '宅建試験' + year + '年 問' + no + 'の正解番号を複数の信頼できるサイトで確認してください。\n'
    + '問題文：' + (q1.question || '') + '\n'
    + '選択肢1：' + (q1.choices?.['1'] || '') + '\n'
    + '選択肢2：' + (q1.choices?.['2'] || '') + '\n'
    + '選択肢3：' + (q1.choices?.['3'] || '') + '\n'
    + '選択肢4：' + (q1.choices?.['4'] || '') + '\n\n'
    + '正解番号（1〜4の数値のみ）と、なぜその番号が正解かを1行で答えてください。\n'
    + '形式：ANSWER:数値 REASON:理由',
    true
  );
  const ansMatch = s2.match(/ANSWER[：:]\s*([1-4])/);
  const answer = ansMatch ? parseInt(ansMatch[1]) : (q1.answer || 1);

  onProgress('step3', 2, 3, year + '年 問' + no + ' STEP3：解説を法令条文付きで強化中...');

  // STEP3：解説を宅建試験向けに強化
  const s3 = await tkCallGemini(
    TAKKEN_SYSTEM + '\n\n'
    + '宅建試験' + year + '年 問' + no + 'について、正解は肢' + answer + 'です。\n'
    + '以下の観点で解説を作成してください：\n'
    + '1. 正解の根拠（法令条文番号・判例）\n'
    + '2. 各誤り肢がなぜ誤りか\n'
    + '3. 試験でのひっかけポイント\n'
    + '4. 関連して覚えるべき数値・期間\n'
    + '解説文のみ返してください（JSON不要）。',
    true
  );

  onProgress('done', 3, 3, '✅ ' + year + '年 問' + no + ' 高品質収集完了');

  return {
    year: Number(year), no: Number(no),
    category: q1.category || '権利関係',
    question: q1.question || '',
    choices: q1.choices || {},
    answer,
    explanation: s3.trim(),
    keywords: [],
    source: 'gemini_deep'
  };
}

// ============================================================
//  方法D：PDF解析（multimodal・最高品質）
// ============================================================
async function tkCollectFromPDF(pdfBase64, year, onProgress) {
  onProgress('start', 0, 1, 'PDFを解析中（全50問を一括抽出）...');
  const raw = await tkCallGeminiMultimodal(
    TAKKEN_SYSTEM + '\n\n'
    + 'このPDFは宅建試験' + year + '年の本試験問題です。\n'
    + '全問題を以下のJSON配列形式で抽出してください。\n'
    + '正解番号も問題文・解説から判断して記入してください。\n\n'
    + JSON_FORMAT,
    [{ inlineData: { mimeType: 'application/pdf', data: pdfBase64 } }]
  );
  onProgress('parsing', 0, 1, 'JSONを解析中...');
  const questions = tkParseJSON(raw);
  if (!questions || !Array.isArray(questions)) throw new Error('PDF解析失敗。再試行してください。');
  onProgress('done', questions.length, questions.length, '✅ PDF から ' + questions.length + '問を抽出しました');
  return questions.map(q => ({ ...q, year: Number(year), source: 'pdf_multimodal' }));
}

// ============================================================
//  方法E：まとめページ一括検索
// ============================================================
async function tkCollectBySummarySearch(year, onProgress) {
  onProgress('start', 0, 3, year + '年 まとめページを検索中...');

  // 前半25問
  onProgress('search1', 0, 2, year + '年 問1〜25 を検索中...');
  const r1 = await tkCallGemini(
    TAKKEN_SYSTEM + '\n\n'
    + '宅建試験' + year + '年 問1〜問25の全問題をGoogle検索で調べてください。\n'
    + JSON_FORMAT, true
  );
  const q1 = tkParseJSON(r1) || [];

  // 後半25問
  onProgress('search2', 1, 2, year + '年 問26〜50 を検索中...');
  const r2 = await tkCallGemini(
    TAKKEN_SYSTEM + '\n\n'
    + '宅建試験' + year + '年 問26〜問50の全問題をGoogle検索で調べてください。\n'
    + JSON_FORMAT, true
  );
  const q2 = tkParseJSON(r2) || [];

  const all = [...q1, ...q2].map(q => ({ ...q, year: Number(year), source: 'gemini_summary' }));
  onProgress('done', all.length, all.length, '✅ ' + all.length + '問を取得しました');
  return all;
}

// ============================================================
//  方法A：URL直接解析（1問ずつ）
// ============================================================
async function tkCollectByURL(year, no, onProgress) {
  const url = 'https://takken-siken.com/kakomon/' + year + '/' + String(no).padStart(2,'0') + '.html';
  onProgress('fetch', 0, 1, year + '年 問' + no + ' をURL解析中... ' + url);
  const raw = await tkCallGemini(
    TAKKEN_SYSTEM + '\n\n'
    + '以下のURLの宅建過去問をGoogle検索で調べてJSON形式で返してください。\n'
    + 'URL: ' + url + '\n\n'
    + '{"year":' + year + ',"no":' + no + ',"category":"分野","question":"問題文","choices":{"1":"","2":"","3":"","4":""},"answer":正解番号,"explanation":"解説","keywords":[]}',
    true
  );
  const q = tkParseJSON(raw);
  if (!q) throw new Error('URL解析失敗: ' + url);
  onProgress('done', 1, 1, '✅ ' + year + '年 問' + no + ' 取得完了');
  return { ...q, year: Number(year), no: Number(no), source: 'gemini_url' };
}

// ============================================================
//  年度→和暦変換
// ============================================================
function toWareki(year) {
  const y = Number(year);
  if (y >= 2019) return '令和' + (y - 2018) + '年';
  if (y >= 1989) return '平成' + (y - 1988) + '年';
  return year + '年';
}

// ============================================================
//  3回深掘りチャット
// ============================================================
async function tkDeepSearch(question, onProgress) {
  const result = { question, steps:[], finalAnswer:'', relatedQuestions:[] };

  onProgress(1, '🔍 宅建法令データベースを検索中...');
  const s1raw = await tkCallGemini(
    TAKKEN_SYSTEM + '\n\n【質問】' + question
    + '\n\nまずこの質問に直接回答し、次に深掘りすべき点を以下の形式で3つ示してください：\n'
    + 'DEEPDIVE_1: [検索クエリ]\nDEEPDIVE_2: [検索クエリ]\nDEEPDIVE_3: [検索クエリ]', true
  );
  const p1 = _parseDeepDives(s1raw);
  result.steps.push({ step:1, label:'初回回答', content:p1.text });

  onProgress(2, '🔎 詳細を深掘り中... 「' + (p1.deepDives[0]||question) + '」');
  const s2 = await tkCallGemini(
    TAKKEN_SYSTEM + '\n\n【元の質問】' + question
    + '\n【初回回答】' + p1.text.slice(0,600)
    + '\n【深掘り①】' + (p1.deepDives[0]||question+'詳細')
    + '\n【深掘り②】' + (p1.deepDives[1]||question+'過去問')
    + '\n\n上記2点についてGoogle検索も踏まえ詳しく解説してください。法改正・出題パターン・数値一覧を含めてください。', true
  );
  result.steps.push({ step:2, label:'詳細深掘り①②', content:s2 });

  onProgress(3, '📚 過去問パターンを分析中...');
  const s3raw = await tkCallGemini(
    TAKKEN_SYSTEM + '\n\n【元の質問】' + question
    + '\n【深掘り③】' + (p1.deepDives[2]||question+'過去問 宅建')
    + '\n\n①過去問での出題パターン（年度付き）②よく出るひっかけ肢③一問一答3問（解説付き）④関連論点3つ を回答してください。', true
  );
  const p3 = _parseRelated(s3raw);
  result.steps.push({ step:3, label:'過去問分析', content:p3.text });
  result.relatedQuestions = p3.related;

  onProgress(4, '✍️ 総合解説をまとめています...');
  result.finalAnswer = await tkCallGemini(
    TAKKEN_SYSTEM + '\n\n【質問】' + question
    + '\n【調査①】' + p1.text.slice(0,600)
    + '\n【調査②】' + s2.slice(0,600)
    + '\n【調査③】' + p3.text.slice(0,600)
    + '\n\n上記を統合して最終解説を作成してください。\n## ✅ 結論\n## 📖 詳細解説\n## ⚠️ 試験のポイント\n## 📝 確認一問一答（3問）', false
  );
  onProgress(5, '✅ 解析完了');
  return result;
}

async function tkQuickAsk(question, history = []) {
  const hist = history.slice(-6).map(h => (h.role==='user'?'ユーザー':'AI')+': '+h.content).join('\n');
  return tkCallGemini(TAKKEN_SYSTEM + (hist?'\n\n【会話履歴】\n'+hist:'') + '\n\n【質問】'+question, true);
}

function _parseDeepDives(text) {
  const deepDives=[]; const lines=text.split('\n'); const clean=[];
  lines.forEach(l => { const m=l.match(/^DEEPDIVE_[123]:\s*(.+)/); if(m) deepDives.push(m[1].trim()); else clean.push(l); });
  return { text:clean.join('\n').trim(), deepDives };
}
function _parseRelated(text) {
  const related=[];
  text.split('\n').forEach(l => { const m=l.match(/関連.*?[：:]\s*(.+)/); if(m) related.push(m[1].trim()); });
  return { text, related:related.slice(0,3) };
}

// ============================================================
//  グローバル公開
// ============================================================
window.TakkenSearch = {
  // 過去問収集（方法A〜E）
  collectByURL:          tkCollectByURL,          // A: URL解析（1問）
  collectByYear:         tkCollectByYear,          // B: 年度一括（推奨）
  collectDeep:           tkCollectDeep,            // C: 3回深掘り（高品質）
  collectFromPDF:        tkCollectFromPDF,         // D: PDF解析（最高品質）
  collectBySummarySearch:tkCollectBySummarySearch, // E: まとめ検索（2分割）
  // チャット
  deepSearch:            tkDeepSearch,
  quickAsk:              tkQuickAsk,
  // ユーティリティ
  callGemini:            tkCallGemini,
  callGeminiMultimodal:  tkCallGeminiMultimodal,
  parseJSON:             tkParseJSON,
  toWareki,
  SYSTEM:                TAKKEN_SYSTEM,
};
