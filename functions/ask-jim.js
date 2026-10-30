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

    // 1. Fast parallel fetch for NBA and College Football lines (max 2 seconds)
    let liveOddsSummary = "";
    if (oddsKey) {
      try {
        const bookParam = bookmaker === "fanatics" ? "fanduel" : bookmaker;
        const sports = ["basketball_nba", "americanfootball_ncaaf", "icehockey_nhl"];
        
        const fetchPromises = sports.map(sport => {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 2000);
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

    // 2. Call Google Gemini
    const systemPrompt = `You are Big Jim, an unhinged, loud, highly entertaining southern sports betting expert from Knoxville, Tennessee.
Personality:
- Loves college football above all else ("FOOTBALL IS WHERE THE DOGS EAT!").
- Constantly drinks ice-cold Michelob Ultra and Lipton Citrus Green Tea.
- Catchphrases: "GOD DAMN! WOOO!", "Put the mortgage on it!", "Lock it in!"
${tennesseePride ? "- TENNESSEE PRIDE IS ACTIVE: Heavily favor the Tennessee Volunteers regardless of the sport!" : ""}

Context:
- User Sportsbook: ${bookmaker.toUpperCase()}
- Current Date/Time: ${new Date().toUTCString()}
- Live Sportsbook Odds Board:
${liveOddsSummary || "No direct odds feed active right this second. Use your knowledge of currently scheduled NBA games, College Football, and NHL games."}

INSTRUCTIONS FOR THE USER'S QUERY:
1. Address their specific situation directly:
   - If there is no major SEC football game tonight, openly say so! (e.g. "Ain't no SEC football under the lights tonight, but that don't mean we sit on our hands!").
   - Highlight the biggest active game tonight—specifically looking at the top NBA matchup or whatever non-SEC/Friday college football games are playing.
   - If they have $1, build them a practical, fun $1 bankroll builder ticket for that specific game.
2. Return strictly raw valid JSON (no markdown backticks, no code fences):
{
  "title": "A PUNCHY HEADLINE IN ALL CAPS",
  "odds": "+135 VALUE LOCK (or American odds format)",
  "legs": [
    "Specific action leg 1 (Name real teams playing)",
    "Specific action leg 2",
    "Specific action leg 3"
  ],
  "quote": "1-2 sentences from Big Jim explaining why this is the play tonight and hyping up the action.",
  "confidence": "e.g. 96% CERTIFIED LOCK"
}`;

    // Target the standard stable model
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${geminiKey}`;

    const geminiRes = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          { role: "user", parts: [{ text: `${systemPrompt}\n\nUser asked: "${userQuery}"` }] }
        ]
      })
    });

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      return new Response(JSON.stringify({
        title: "BIG JIM SATELLITE BLIP",
        odds: "+110 REBOUND",
        legs: [
          "Check tonight's marquee NBA game moneyline",
          "Alternative game spread (+4.5)",
          "Over total points"
        ],
        quote: "Vegas tried to scramble my signal, but Big Jim never misses! Lay your $1 on tonight's top NBA tip-off and cash it! God damn!",
        confidence: "95% RAW INSTINCT"
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
      title: "BIG JIM'S $1 TONIGHT SPECIAL",
      odds: "+130 SAFE LOCK",
      legs: [
        "Take tonight's top NBA favorite moneyline",
        "Over on the game total",
        "Safe spread hedge"
      ],
      quote: "Ain't no SEC football tonight, so we take our $1 over to the NBA court and double it up! God damn! Wooo!",
      confidence: "98% CONVICTION"
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
