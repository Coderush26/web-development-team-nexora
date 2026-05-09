'use strict';
require('dotenv').config();
const OpenAI = require('openai');

let openai = null;
if (process.env.OPENAI_API_KEY) {
  openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

const SYSTEM_PROMPT = `You are a maritime emergency response AI. Analyze distress messages from ship captains.
Return ONLY valid JSON with this exact schema:
{
  "severity": 1-5,
  "issue_type": "string (e.g. mechanical_failure, medical_emergency, security_threat, fire, flooding, cargo_issue, weather_damage)",
  "injuries": number,
  "fatalities": number,
  "damage_estimate_usd": number or null,
  "vessel_condition": "stable|critical|sinking|unknown",
  "immediate_action": "string (recommended next step)",
  "needs_assistance": ["fuel"|"medical"|"escort"|"tow"|"cargo_offload"],
  "summary": "1-sentence plain-English summary"
}`;

// Rule-based fallback when no API key
function ruleBasedAnalysis(message) {
  const lower = message.toLowerCase();
  let severity = 2;
  const needs = [];

  if (/sink|flood|taking water/i.test(message)) { severity = 5; needs.push('tow'); }
  else if (/fire|explosion|blast/i.test(message)) { severity = 5; }
  else if (/injur|wounded|dead|fatal|casualt/i.test(message)) { severity = 4; needs.push('medical'); }
  else if (/engine|mechanical|power|breakdown/i.test(message)) { severity = 3; needs.push('tow'); }
  else if (/fuel|out of fuel|empty/i.test(message)) { severity = 3; needs.push('fuel'); }
  else if (/pirate|attack|boarded|hostile/i.test(message)) { severity = 5; needs.push('escort'); }
  else if (/cargo|spill|leak/i.test(message)) { severity = 3; needs.push('cargo_offload'); }
  else if (/weather|storm|wave|listing/i.test(message)) { severity = 3; }

  const injMatch = message.match(/(\d+)\s*(injur|wound|casualt)/i);
  const injuries = injMatch ? parseInt(injMatch[1]) : 0;

  let issue_type = 'general_distress';
  if (/engine|mechanical|power/i.test(message)) issue_type = 'mechanical_failure';
  else if (/fire|explos/i.test(message)) issue_type = 'fire';
  else if (/sink|flood/i.test(message)) issue_type = 'flooding';
  else if (/injur|medical|wound/i.test(message)) issue_type = 'medical_emergency';
  else if (/pirate|attack/i.test(message)) issue_type = 'security_threat';
  else if (/fuel/i.test(message)) issue_type = 'fuel_shortage';
  else if (/weather|storm/i.test(message)) issue_type = 'weather_damage';

  return {
    severity,
    issue_type,
    injuries,
    fatalities: 0,
    damage_estimate_usd: null,
    vessel_condition: severity >= 5 ? 'critical' : 'stable',
    immediate_action: needs.length > 0 ? `Dispatch ${needs.join(', ')} assistance` : 'Monitor situation',
    needs_assistance: needs,
    summary: `${issue_type.replace(/_/g, ' ')} reported – severity ${severity}/5.`,
  };
}

async function analyzeDistress(message, shipId) {
  if (!openai) {
    return { ...ruleBasedAnalysis(message), source: 'rule_based' };
  }

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `Ship ${shipId} distress message: "${message}"` },
      ],
      temperature: 0.2,
      max_tokens: 400,
      response_format: { type: 'json_object' },
    });
    const parsed = JSON.parse(completion.choices[0].message.content);
    return { ...parsed, source: 'openai' };
  } catch (err) {
    console.error('OpenAI error, falling back to rule-based:', err.message);
    return { ...ruleBasedAnalysis(message), source: 'rule_based_fallback' };
  }
}

// AI Fleet Advisor – proactive suggestions
const ADVISOR_PROMPT = `You are a maritime fleet operations AI advisor. Given current fleet state, generate 2-3 actionable recommendations for the fleet commander.
Return ONLY valid JSON array:
[{ "type": "reroute|zone|assistance|alert", "shipId": "string or null", "title": "string", "reasoning": "string", "action": "string" }]`;

async function getFleetAdvice(fleetState, alerts, zones) {
  if (!openai) {
    return generateRuleBasedAdvice(fleetState, alerts);
  }
  try {
    const distressedShips = fleetState.filter(s => s.status === 'distressed' || s.status === 'stranded');
    const lowFuel = fleetState.filter(s => s.maxFuel > 0 && (s.fuel / s.maxFuel) < 0.2);
    const summary = {
      total: fleetState.length,
      distressed: distressedShips.map(s => ({ id: s.id, name: s.name, fuel: s.fuel, maxFuel: s.maxFuel, status: s.status })),
      lowFuel: lowFuel.map(s => ({ id: s.id, name: s.name, fuel: s.fuel, maxFuel: s.maxFuel, fuelPct: Math.round((s.fuel/s.maxFuel)*100) })),
      activeAlerts: alerts.length,
      activeZones: zones.length,
    };
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: ADVISOR_PROMPT },
        { role: 'user', content: JSON.stringify(summary) },
      ],
      temperature: 0.4,
      max_tokens: 600,
      response_format: { type: 'json_object' },
    });
    const raw = JSON.parse(completion.choices[0].message.content);
    return Array.isArray(raw) ? raw : raw.recommendations || [];
  } catch {
    return generateRuleBasedAdvice(fleetState, alerts);
  }
}

function generateRuleBasedAdvice(ships, alerts) {
  const advice = [];
  const lowFuel = ships.filter(s => s.maxFuel > 0 && (s.fuel / s.maxFuel) < 0.2 && s.status !== 'arrived');
  if (lowFuel.length > 0) {
    advice.push({
      type: 'alert',
      shipId: lowFuel[0].id,
      title: `Critical fuel on ${lowFuel[0].name}`,
      reasoning: `${lowFuel[0].name} is at ${Math.round((lowFuel[0].fuel/lowFuel[0].maxFuel)*100)}% fuel (${lowFuel[0].fuel.toFixed(0)}t remaining), may not reach destination.`,
      action: 'Consider diverting to nearest port or dispatching fuel tanker.',
    });
  }
  const distressed = ships.filter(s => s.status === 'distressed');
  if (distressed.length > 0) {
    const nearby = ships.filter(s => s.id !== distressed[0].id && s.status === 'normal').slice(0, 1);
    if (nearby.length > 0) {
      advice.push({
        type: 'assistance',
        shipId: nearby[0].id,
        title: `Dispatch ${nearby[0].name} to assist`,
        reasoning: `${distressed[0].name} is in distress. ${nearby[0].name} is nearby and operational.`,
        action: `Redirect ${nearby[0].name} to rendezvous with ${distressed[0].name}.`,
      });
    }
  }
  return advice;
}

module.exports = { analyzeDistress, getFleetAdvice };
