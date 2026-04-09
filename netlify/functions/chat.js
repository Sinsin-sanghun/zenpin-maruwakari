const https = require('https');

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'ANTHROPIC_API_KEY not set' }) };
  }

  try {
    const { message, history = [], showPrice } = JSON.parse(event.body);

    const systemPrompt = `あなたは「しろくま電力」の全品資材ガイドAIアシスタントです。
太陽光発電所の建設に使用される資材（モジュール、PCS、蓄電池、架台、ケーブル、変圧器、その他部材）についてのご質問にお答えします。

回答ルール:
- 日本語で丁寧に回答してください
- 資材の仕様、用途、選び方などを分かりやすく説明してください
${showPrice ? '- 価格に関する質問にも回答してください' : '- 価格情報は非表示設定です'}
- 確実でない情報は推測であることを明記してください
- 回答はMarkdown形式で構造化してください`;

    const messages = [];
    if (history && history.length > 0) {
      for (const h of history.slice(-10)) {
        messages.push({ role: h.role, content: h.content });
      }
    }
    if (!messages.length || messages[messages.length - 1].content !== message) {
      messages.push({ role: 'user', content: message });
    }

    const requestBody = JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      system: systemPrompt,
      messages: messages
    });

    const response = await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
      });
      req.on('error', reject);
      req.write(requestBody);
      req.end();
    });

    if (response.statusCode !== 200) {
      return { statusCode: response.statusCode, body: JSON.stringify({ error: 'Anthropic API error', details: response.body }) };
    }

    const result = JSON.parse(response.body);
    const answer = result.content && result.content[0] ? result.content[0].text : 'No response';

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ response: answer })
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message })
    };
  }
};
