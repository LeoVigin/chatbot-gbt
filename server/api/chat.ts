export default defineEventHandler(async (event) => {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not defined');

  // Read what app.vue sends
  const body = await readBody(event);
  const { messages, model, stream } = body;

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: model ?? 'mistralai/mistral-small-2603',
      messages,
      stream: stream ?? true,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw createError({ statusCode: response.status, message: error });
  }

  // Stream the response back to app.vue
  setHeader(event, 'Content-Type', 'text/event-stream');
  setHeader(event, 'Cache-Control', 'no-cache');
  setHeader(event, 'Connection', 'keep-alive');

  return sendStream(event, response.body!);
});