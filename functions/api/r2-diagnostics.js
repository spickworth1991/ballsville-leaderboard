export async function onRequestGet(context) {
  const { LEADERBOARDS } = context.env;

  try {
    // List first 50 objects
    const listResp = await LEADERBOARDS.list({ limit: 50 });
    return new Response(JSON.stringify(listResp.objects, null, 2), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(`Error listing R2: ${err.message}`, { status: 500 });
  }
}

export async function onRequestPost(context) {
  const { LEADERBOARDS } = context.env;

  try {
    // Create test file
    const key = `test_${Date.now()}.txt`;
    const content = `This is a test file created at ${new Date().toISOString()}`;
    await LEADERBOARDS.put(key, content);

    // Read it back
    const obj = await LEADERBOARDS.get(key);
    const body = obj ? await obj.text() : null;

    return new Response(
      JSON.stringify({ key, content: body }, null, 2),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(`Error writing to R2: ${err.message}`, { status: 500 });
  }
}
