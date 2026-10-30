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
    const userQuery = body.query || "what games are on tonight?";
    let bookmaker = body.bookmaker || "fanduel";
    const tennesseePride = Boolean(body.tennesseePride);

    const geminiKey = env.GEMINI_API_KEY;
    const oddsKey = env.ODDS_API_KEY;

    if (!geminiKey) {
      return new Response(JSON.stringify({
        title: "CLOUDFLARE CONFIG ERROR",
        odds: "MISSING KEY",
        legs: ["GEMINI_API_KEY secret is not bound in Cloudflare Pages"],
        quote: "Hey James, the Gemini key is missing in your Cloudflare environment settings! God damn!",
        confidence: "0%"
      }), { status: 200, headers: corsHeaders });
    }

    // 1. Fetch live games from The Odds API
    let liveOddsSummary = "";
    if (oddsKey) {
      try {
        const sports = [
          "basketball_nba",
          "icehockey_nhl",
          "baseball_mlb",
          "americanfootball_nfl",
          "americanfootball_ncaaf"
        ];

        const bookQuery = (bookmaker === "fanatics") ? "fanatics,fanduel,draftkings" : bookmaker;

        const fetchPromises = sports.map(sport =>
          fetch(`https://api.the-odds-api.com/v4/sports/${sport}/odds/?apiKey=${oddsKey}&regions=us&markets=h2h,spreads&bookmakers=${bookQuery}`)
            .then(res => res.ok ? res.json() : [])
            .catch(() => [])
        );

        const results = await Promise.all(fetchPromises);
        let collectedGames = [];

        results.flat().forEach(game => {
          if (!game || !game.home_team) return;
          const bookie = game.bookmakers?.[0];
          let lines = [];
          if (bookie && bookie.markets) {
            bookie.markets.forEach(m => {
              if (m.key === "spreads") {
                lines.push(`Spread: ${m.outcomes?.map(o => `${o.name} ${o.point > 0 ? '+' : ''}${o.point} (${o.price})`).join(' vs ')}`);
              }
              if (m.key === "h2h") {
                lines.push(`ML: ${m.outcomes?.map(o => `${o.name} (${o.price})`).join(' vs ')}`);
              }
            });
          }
          collectedGames.push({
            sport: game.sport_title,
            matchup: `${game.away_team} at ${game.home_team}`,
            time: game.commence_time,
            lines: lines.join(" | ")
          });
        });

        if (collectedGames.length > 0) {
          liveOddsSummary = JSON.stringify(collectedGames.slice(0, 10));
        }
      } catch (err) {
        liveOddsSummary = "Odds fetch issue: " + err.message;
      }
    }

    // 2. Call Google Gemini (using the active 2.5-flash model)
    const systemPrompt = `You are Big Jim, an unhinged, loud, lovable southern sports betting savant from Knoxville, Tennessee.
Catchphrases: "GOD DAMN! WOOO!", "Put the mortgage on it!", cracking cold Michelob Ultras and sipping Lipton Citrus Iced Green Tea.
${tennesseePride ? "TENNESSEE PRIDE IS ACTIVE: Glaze the Tennessee Volunteers regardless of the sport!" : ""}

Selected Sportsbook: ${bookmaker.toUpperCase()}
Today's Date: ${new Date().toDateString()}

Real games currently on the schedule/board:
${liveOddsSummary || "No direct feed games right now. Use your own sports knowledge for today's scheduled games."}

INSTRUCTIONS:
1. Address the user's specific prompt directly (e.g. if they ask what games are on tonight and say they only have $1, name real matchups and give them an exact $1 bet).
2. Format response strictly as pure JSON (NO markdown, NO backticks, NO \`\`\`json):
{
  "title": "A PUNCHY HEADLINE IN ALL CAPS",
  "odds": "+150 LOCK or -110 HIGH PROBABILITY",
  "legs": [
    "Specific bet on a real game 1",
    "Specific bet on a real game 2",
    "Specific bet on a real game 3"
  ],
  "quote": "1-2 sentence unhinged Big Jim quote directly addressing what they asked.",
  "confidence": "99% STONE COLD LOCK"
}`;

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`;

    const geminiRes = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          { role: "user", parts: [{ text: `${systemPrompt}\n\nUser Question: ${userQuery}` }] }
        ]
      })
    });

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      return new Response(JSON.stringify({
        title: "GEMINI API REJECTED REQUEST",
        odds: `CODE ${geminiRes.status}`,
        legs: [`Error details: ${errText.substring(0, 120)}`],
        quote: "Vegas jammed the satellite, Gemini returned an error! God damn!",
        confidence: "0%"
      }), { status: 200, headers: corsHeaders });
    }

    const geminiData = await geminiRes.json();
    const rawText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    const cleaned = rawText.replace(/```json/g, "").replace(/```/g, "").trim();
    const cleanJson = JSON.parse(cleaned);

    return new Response(JSON.stringify(cleanJson), {
      status: 200,
      headers: corsHeaders
    });

  } catch (err) {
    return new Response(JSON.stringify({
      title: "BIG JIM CRASH REPORT",
      odds: "OFFLINE",
      legs: [`Error: ${err.message}`],
      quote: "Someone spilled beer on the router! God damn!",
      confidence: "0%"
    }), { status: 200, headers: corsHeaders });
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
