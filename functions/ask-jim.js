export async function onRequestPost(context) {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json"
  };

  try {
    const { request, env } = context;
    const body = await request.json().catch(() => ({}));
    const userQuery = body.query || "what should I bet tonight?";
    const bookmaker = body.bookmaker || "fanduel";
    const tennesseePride = Boolean(body.tennesseePride);

    const geminiKey = env.GEMINI_API_KEY;
    const oddsKey = env.ODDS_API_KEY;

    if (!geminiKey) {
      return new Response(JSON.stringify({
        error: "GEMINI_API_KEY is not defined in Cloudflare settings."
      }), { status: 500, headers: corsHeaders });
    }

    // 1. Fetch live odds from The Odds API across active sports
    let liveOddsSummary = "No active games found on the board right now.";
    if (oddsKey) {
      try {
        const sports = [
          "basketball_nba",
          "icehockey_nhl",
          "baseball_mlb",
          "americanfootball_nfl",
          "americanfootball_ncaaf"
        ];

        const fetchPromises = sports.map(sport =>
          fetch(`https://api.the-odds-api.com/v4/sports/${sport}/odds/?apiKey=${oddsKey}&regions=us&markets=h2h,spreads,totals&bookmakers=${bookmaker}`, {
            headers: { "User-Agent": "BigJimPickDog/1.0" }
          }).then(res => res.ok ? res.json() : []).catch(() => [])
        );

        const results = await Promise.all(fetchPromises);
        let collectedGames = [];

        results.flat().forEach(game => {
          if (!game || !game.home_team) return;
          const bookie = game.bookmakers?.find(b => b.key === bookmaker) || game.bookmakers?.[0];
          let lines = [];
          if (bookie && bookie.markets) {
            bookie.markets.forEach(m => {
              if (m.key === "spreads") {
                lines.push(`Spread: ${m.outcomes?.map(o => `${o.name}${o.point > 0 ? '+' : ''}${o.point} (${o.price})`).join(' vs ')}`);
              }
              if (m.key === "h2h") {
                lines.push(`Moneyline: ${m.outcomes?.map(o => `${o.name} (${o.price})`).join(' vs ')}`);
              }
              if (m.key === "totals") {
                lines.push(`Total: O/U ${m.outcomes?.[0]?.point || ''}`);
              }
            });
          }
          collectedGames.push({
            sport: game.sport_title,
            matchup: `${game.away_team} @ ${game.home_team}`,
            commenceTime: game.commence_time,
            oddsLines: lines.join(" | ")
          });
        });

        if (collectedGames.length > 0) {
          liveOddsSummary = JSON.stringify(collectedGames.slice(0, 10), null, 2);
        }
      } catch (err) {
        liveOddsSummary = "Odds fetch error: " + err.message;
      }
    }

    // 2. Query Gemini 1.5 Flash
    const systemPrompt = `You are Big Jim, an unhinged, loud, lovable southern sports betting savant from Knoxville, Tennessee.
Catchphrases: "GOD DAMN! WOOO!", "Put the mortgage on it!", cracking cold Michelob Ultras and sipping Lipton Citrus Iced Green Tea.
${tennesseePride ? "TENNESSEE PRIDE IS ACTIVE: Always glaze the Tennessee Volunteers if they play, or relate the answer to Rocky Top!" : ""}

Sportsbook selected by user: ${bookmaker.toUpperCase()}
Current Timestamp: ${new Date().toUTCString()}

Real-time Sportsbook Games & Lines available today:
${liveOddsSummary}

INSTRUCTIONS:
1. Directly answer the user's scenario (e.g. if they say "I only have $1", give them realistic, practical advice in Big Jim's persona).
2. If live games exist in the data above, use those exact matchups and lines. If no games are currently live, tell them straight up like Big Jim would.
3. Respond ONLY with raw JSON (no markdown ticks or code blocks):
{
  "title": "PUNCHY TITLE IN ALL CAPS",
  "odds": "+150 LOCK or -110 HIGH PROBABILITY",
  "legs": [
    "Specific bet action 1",
    "Specific bet action 2",
    "Specific bet action 3"
  ],
  "quote": "1-2 sentence unhinged Big Jim quote addressing their specific question.",
  "confidence": "e.g. 99% RAW CONVICTION"
}`;

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`;

    const geminiRes = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: `${systemPrompt}\n\nUser Question: "${userQuery}"` }] }],
        generationConfig: { temperature: 0.7, responseMimeType: "application/json" }
      })
    });

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      throw new Error(`Gemini API error ${geminiRes.status}: ${errText}`);
    }

    const geminiData = await geminiRes.json();
    const rawText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;
    const cleanJson = JSON.parse(rawText.replace(/```json/g, "").replace(/```/g, "").trim());

    return new Response(JSON.stringify(cleanJson), { status: 200, headers: corsHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    }
  });
}
