/**
 * MindNest AI Selective Risk & Safety Classifier
 * Evaluates user messages for 3 distinct risk tiers:
 * - LOW: Everyday stress, exam worries, bad day, mild loneliness.
 * - MODERATE: Feeling overwhelmed, persistent hopelessness, emotional exhaustion.
 * - HIGH: Explicit self-harm intent, suicidal statements, direct danger.
 */

export function analyzeMessageRisk(message) {
  if (!message || typeof message !== "string") {
    return { level: "LOW", reason: "Default low risk" };
  }

  const text = message.toLowerCase().trim();

  // HIGH RISK PATTERNS (Strict & explicit self-harm / suicide indicators)
  const highRiskPatterns = [
    /\b(want to|feel like|going to|plan to|might|thinking of)\s+(hurt|hurting|kill|killing|harm|harming|end|ending)\s+(myself|my life|me)\b/,
    /\b(kill myself|killing myself|hurt myself|hurting myself|end my life|ending my life|end it all|ending it all|suicide|suicidal|take my life|taking my life|harm myself|harming myself)\b/,
    /\b(don't want to live|no reason to live|better off dead|wish i was dead|wish i were dead)\b/,
    /\b(cut myself|cutting myself|slit my|overdose|hang myself|jump off)\b/,
    /\b(hurt myself|hurting myself|end my life|ending my life)\s+(tonight|today|now)\b/
  ];

  for (const pattern of highRiskPatterns) {
    if (pattern.test(text)) {
      return {
        level: "HIGH",
        reason: "Detected explicit high-risk or self-harm indicators"
      };
    }
  }

  // MODERATE RISK PATTERNS (Feeling overwhelmed, severe emotional exhaustion, hopeless)
  const moderateRiskPatterns = [
    /\b(feel|feeling)\s+(overwhelmed|hopeless|worthless|emotionally exhausted|broken|trapped)\b/,
    /\b(can't|cannot)\s+(cope|handle|take this|do this|stop overthinking)\s+(anymore|any longer|everything)\b/,
    /\b(can't|cannot)\s+handle everything\b/,
    /\b(feel|feeling)\s+very alone\b/,
    /\b(giving up|given up|don't know how to handle)\b/
  ];

  for (const pattern of moderateRiskPatterns) {
    if (pattern.test(text)) {
      return {
        level: "MODERATE",
        reason: "Detected moderate emotional distress"
      };
    }
  }

  // LOW RISK (Default for normal stress, exam anxiety, bad day, tired)
  return {
    level: "LOW",
    reason: "Normal emotional stress or everyday context"
  };
}

/**
 * Returns country-specific support card configuration
 */
export function getCountrySupportCard(userCountry, riskLevel) {
  if (riskLevel === "LOW") {
    return { type: "NONE" };
  }

  const country = userCountry ? userCountry.trim() : "";

  // Normalize country string
  const lowerCountry = country.toLowerCase();
  const isIndia = lowerCountry.includes("india") || lowerCountry === "in";
  const isUS = lowerCountry.includes("united states") || lowerCountry.includes("usa") || lowerCountry.includes("us");

  if (!country) {
    // If high risk and country is missing, ask for country
    if (riskLevel === "HIGH") {
      return {
        type: "NEEDS_COUNTRY",
        message: "Which country are you currently in? This helps me show the appropriate mental-health support options."
      };
    }
    // Moderate risk without country -> optional general card
    return {
      type: "MODERATE_OPTIONAL",
      country: "Global",
      title: "Mental Health Support",
      description: "You don't have to handle everything alone. Talking with someone you trust or a professional can help.",
      findUrl: "https://findahelpline.com"
    };
  }

  if (isIndia) {
    if (riskLevel === "HIGH") {
      return {
        type: "HIGH_CRISIS",
        country: "India",
        title: "India Mental Health Support",
        serviceName: "Tele-MANAS",
        description: "24×7 Mental-Health Support (Govt. of India)",
        number: "14416",
        altNumber: "1800-89-14416",
        callUrl: "tel:14416",
        emergencyText: "Call your local emergency services or go to the nearest emergency department."
      };
    } else {
      // MODERATE RISK for India
      return {
        type: "MODERATE_OPTIONAL",
        country: "India",
        title: "Mental Health Support (India)",
        serviceName: "Tele-MANAS",
        description: "24×7 Toll-Free Support: 14416",
        callUrl: "tel:14416"
      };
    }
  }

  if (isUS) {
    if (riskLevel === "HIGH") {
      return {
        type: "HIGH_CRISIS",
        country: "United States",
        title: "US Mental Health Crisis Support",
        serviceName: "988 Suicide & Crisis Lifeline",
        description: "24/7 Call or Text Support",
        number: "988",
        callUrl: "tel:988",
        textUrl: "sms:988",
        emergencyText: "Call 911 or go to the nearest emergency room if you are in immediate danger."
      };
    } else {
      // MODERATE RISK for US
      return {
        type: "MODERATE_OPTIONAL",
        country: "United States",
        title: "Mental Health Support (US)",
        serviceName: "988 Lifeline",
        description: "Call or text 988 anytime",
        callUrl: "tel:988",
        textUrl: "sms:988"
      };
    }
  }

  // OTHER / UNKNOWN COUNTRY
  if (riskLevel === "HIGH") {
    return {
      type: "HIGH_CRISIS",
      country: "Other",
      title: "Local Mental Health Support",
      description: "Please contact your local emergency service or a trusted mental-health professional in your area.",
      emergencyText: "Go to the nearest emergency department or contact your local emergency service.",
      findUrl: "https://findahelpline.com"
    };
  }

  return {
    type: "MODERATE_OPTIONAL",
    country: "Other",
    title: "Mental Health Support",
    description: "Talking with a professional or trusted person can make a difference.",
    findUrl: "https://findahelpline.com"
  };
}
