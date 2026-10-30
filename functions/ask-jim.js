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
    const history = Array.isArray(body.history) ? body.history : [];

    const geminiKey = env.GEMINI_API_KEY;
    const oddsKey = env.ODDS_API_KEY;

    if (!geminiKey) {
      return new Response(JSON.stringify({
        title: "CLOUDFLARE CONFIG ERROR",
        odds: "MISSING KEY",
        legs: ["GEMINI_API_KEY secret is missing in Cloudflare Pages"],
        quote: "Hey James, the Gemini key isn't set up in Cloudflare! God damn!",
        confidence: "0%",
        options: []
      }), { status: 200, headers: corsHeaders });
    }

    // 1. Fetch live sports slate across active leagues
    let liveOddsSummary = "";
    if (oddsKey) {
      try {
        const bookParam = bookmaker === "fanatics" ? "fanduel" : bookmaker;
        const sports = ["basketball_nba", "americanfootball_ncaaf", "icehockey_nhl"];
        
        const fetchPromises = sports.map(sport => {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 2200);
          return fetch(`https://api.the-odds-api.com/v4/sports/${sport}/odds/?apiKey=${oddsKey}&regions=us&markets=h2h,spreads&bookmakers=${bookParam}`, {
            signal: controller.signal
          })
          .then(res => {
            clearTimeout(timeoutId);
            return res.ok ? res.json() : [];
          })
          .catch(() => []);
        });

        const results = await Promise.all(fetchPromises);
        let collected = [];

        results.flat().forEach(game => {
          if (!game || !game.home_team) return;
          const bookie = game.bookmakers?.[0];
          let spreadStr = "";
          if (bookie && bookie.markets) {
            const spreadMarket = bookie.markets.find(m => m.key === "spreads");
            if (spreadMarket) {
              spreadStr = spreadMarket.outcomes?.map(o => `${o.name} ${o.point > 0 ? '+' : ''}${o.point} (${o.price})`).join(' vs ');
            }
          }
          collected.push(`[${game.sport_title}] ${game.away_team} @ ${game.home_team} ${spreadStr ? '| ' + spreadStr : ''}`);
        });

        if (collected.length > 0) {
          liveOddsSummary = collected.slice(0, 8).join("\n");
        }
      } catch (err) {
        liveOddsSummary = "";
      }
    }

    // 2. Build Prompt for Multi-Sport Curation & Player Props
    const systemInstruction = `You are Big Jim, an unhinged, charismatic, high-energy southern sports betting guru from Knoxville, Tennessee.
Tone & Persona:
- You love college football above everything ("FOOTBALL IS WHERE REAL DOGS EAT!").
- You chug cold Michelob Ultra and Lipton Citrus Green Tea.
- Catchphrases: "GOD DAMN! WOOO!", "Put the mortgage on it!", "Lock it in!"
${tennesseePride ? "- TENNESSEE PRIDE ACTIVE: Always hype up the Tennessee Volunteers!" : ""}

Live Sportsbook Board:
${liveOddsSummary || "Use scheduled prime-time NBA games, College Football, and NHL games for tonight."}
Selected Bookmaker: ${bookmaker.toUpperCase()}

CRITICAL CURATION BEHAVIOR:
1. When asked what games are on or for bet ideas:
   - Name ACTUAL TEAMS and REAL STAR PLAYERS (e.g. for NBA: Anthony Edwards, Giannis, Jokic, Tatum, Brunson; for College Football: specific quarterbacks / running backs).
   - If there is no major SEC football game tonight, call it out directly! State what football IS playing (Group of 5, Friday night CFB) and compare it with the marquee NBA / NHL matchups tonight.
   - If user has $1, explicitly instruct them how to wager that $1 (safe bankroll builder vs moonshot).
2. INTERACTIVE OPTIONS:
   - In the "options" array, provide 2 to 4 clickable follow-up options for the user so they can curate the bet!
   - Examples: "🏀 Lock in NBA Underdog Moneyline", "🏈 Switch to Friday College Football", "🎯 Add a Player Prop", "🔥 Go Unhinged High Odds".

STRICT OUTPUT FORMAT: Return ONLY valid JSON (no markdown formatting, no \`\`\`json):
{
  "title": "PUNCHY TICKET TITLE IN ALL CAPS",
  "odds": "+135 VALUE LOCK",
  "legs": [
    "Real Bet Action 1 (Team name + line)",
    "Real Bet Action 2 (Player prop or spread)",
    "Real Bet Action 3 (Total points or alternative line)"
  ],
  "quote": "1-2 sentence Big Jim reaction addressing their exact question.",
  "confidence": "e.g. 96% CERTIFIED VALUE",
  "options": [
    "Short Button Text 1",
    "Short Button Text 2",
    "Short Button Text 3"
  ]
}`;

    // Query Google Gemini with model fallback cascade
    const candidateModels = ["gemini-2.0-flash", "gemini-1.5-flash", "gemini-1.5-pro"];
    let cleanJson = null;

    for (const modelName of candidateModels) {
      try {
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${geminiKey}`;
        
        let contents = [];
        // Add conversation history for interactive refinement
        if (history.length > 0) {
          history.slice(-4).forEach(h => {
            contents.push({ role: h.role === "user" ? "user" : "model", parts: [{ text: h.text }] });
          });
        }
        contents.push({ role: "user", parts: [{ text: `${systemInstruction}\n\nUser Question: ${userQuery}` }] });

        const geminiRes = await fetch(geminiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: contents,
            generationConfig: { temperature: 0.7, responseMimeType: "application/json" }
          })
        });

        if (geminiRes.ok) {
          const geminiData = await geminiRes.json();
          const rawText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;
          if (rawText) {
            cleanJson = JSON.parse(rawText.replace(/```json/g, "").replace(/```/g, "").trim());
            break;
          }
        }
      } catch (e) {
        // Try next model in candidateModels list
      }
    }

    if (!cleanJson) {
      // Dynamic fallback with interactive buttons
      cleanJson = {
        title: "TONIGHT'S MULTI-SPORT $1 BOARD",
        odds: "+145 SOLID ACTION",
        legs: [
          "NBA Prime-Time: Home Favorite Moneyline (-130)",
          "Star Player Prop: 20+ Points / 5+ Assists (-115)",
          "Total Game Points: OVER (-110)"
        ],
        quote: "Ain't no SEC football under the lights tonight, but we got NBA buckets and late-night action! What sport are you leaning towards? God damn! Pick below!",
        confidence: "95% READY TO ROLL",
        options: [
          "🏀 Show me the biggest NBA game tonight",
          "🏈 Any College Football playing tonight?",
          "🎯 Give me a 1-player prop lock for $1",
          "🔥 Unhinged 4-leg parlay instead"
        ]
      };
    }

    return new Response(JSON.stringify(cleanJson), {
      status: 200,
      headers: corsHeaders
    });

  } catch (err) {
    return new Response(JSON.stringify({
      title: "BIG JIM'S REBOUND SLIP",
      odds: "+125 CASH IT",
      legs: ["Take tonight's top NBA moneyline", "Alternative Spread Cover"],
      quote: "Someone bumped the wire, but Big Jim's line still stands! God damn!",
      confidence: "90% CONVICTION",
      options: ["🏀 More NBA", "🏈 College Football"]
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
