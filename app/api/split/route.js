import { GoogleGenAI } from '@google/genai';

export async function POST(req) {
  try {
    const { sentence } = await req.json();
    if (!process.env.GEMINI_API_KEY) {
      return Response.json({ error: 'GEMINI_API_KEY is missing' }, { status: 500 });
    }
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const prompt =
      'You turn a plain-English expense sentence into a bill split. ' +
      'Return ONLY strict JSON with these keys: amount (number, the total), ' +
      'people (whole number, how many share it), each (number, amount per person), ' +
      'description (short text). No markdown, no extra words.\n\nSentence: "' + sentence + '"';
    // The free AI can be busy — try up to 3 times before giving up.
    let response;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        response = await ai.models.generateContent({
          model: 'gemini-flash-lite-latest',
          contents: prompt,
          config: { responseMimeType: 'application/json' },
        });
        break;
      } catch (e) {
        if (attempt === 3) throw e;
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
    const text = (response.text || '').trim().replace(/^```json\s*|\s*```$/g, '');
    return Response.json(JSON.parse(text));
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}