// ============================================
// Netlify Function: AIチャット (Claude API)
// ファイル配置: netlify/functions/chat.js
// ============================================
 
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
 
exports.handler = async (event) => {
  // CORSヘッダー
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };
 
  // OPTIONSリクエスト対応
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }
 
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }
 
  try {
    const { message, history } = JSON.parse(event.body);
 
    if (!message) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'メッセージが空です' }) };
    }
 
    // 環境変数からAPIキーを取得（安全）
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'APIキーが設定されていません' }) };
    }
 
    // 会話履歴を構築
    const messages = [];
    if (history && Array.isArray(history)) {
      history.forEach(h => {
        messages.push({ role: h.role, content: h.content });
      });
    }
    messages.push({ role: 'user', content: message });
 
    // Claude APIを呼び出し
    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2048,
        system: 'あなたは資材管理の専門AIアシスタントです。日本語で丁寧に回答してください。',
        messages: messages
      })
    });
 
    const data = await response.json();
 
    if (!response.ok) {
      console.error('Claude API error:', data);
      return {
        statusCode: response.status,
        headers,
        body: JSON.stringify({ error: data.error?.message || 'AI APIエラーが発生しました' })
      };
    }
 
    const aiResponse = data.content?.[0]?.text || '応答を取得できませんでした';
 
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ response: aiResponse })
    };
 
  } catch (error) {
    console.error('Function error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'サーバーエラーが発生しました: ' + error.message })
    };
  }
};
