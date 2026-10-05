// src/content/dialogue/dialogueTrees.ts
// Every conversation, keyed by the dialogueTreeId an NPC placement points at.

import type { DialogueTree } from "../../types";

// ---------- Dialogue ----------

export const DIALOGUE_TREES: Record<string, DialogueTree> = {
  "snoop-intro": {
    npcId: "snoop",
    startNodeId: "start",
    nodes: {
      start: {
        id: "start",
        speaker: "Snoop Cordozar",
        text:
          "Clipper. My father says the Opps have been asking around the market again — asking about you, specifically.",
        choices: [
          {
            id: "ask-opps",
            text: "What exactly are they asking?",
            nextNodeId: "opps-detail",
          },
          {
            id: "brush-off",
            text: "Let them ask. I've got nothing to hide.",
            nextNodeId: "brush-off",
            reputationDelta: { target: "cordozar", amount: -5 },
          },
        ],
      },
      "opps-detail": {
        id: "opps-detail",
        speaker: "Snoop Cordozar",
        text:
          "Whether you know anything about the Za. Be careful who you talk to down by the docks tonight.",
        choices: [
          {
            id: "thanks",
            text: "Thanks for the warning.",
            nextNodeId: null,
            reputationDelta: { target: "cordozar", amount: 10 },
            questFlag: "opps-warning-received",
          },
        ],
      },
      "brush-off": {
        id: "brush-off",
        speaker: "Snoop Cordozar",
        text: "...That's exactly the kind of thing that gets people hurt, Clipper.",
        choices: [{ id: "end", text: "[End conversation]", nextNodeId: null }],
      },
    },
  },
  "mary-jane-intro": {
    npcId: "mary-jane",
    startNodeId: "start",
    nodes: {
      start: {
        id: "start",
        speaker: "Mary Jane",
        text:
          "You're out later than usual. My mother says the market's not safe after dark these days.",
        choices: [
          {
            id: "flirt",
            text: "Safer with you here, though.",
            nextNodeId: "flirt-response",
            reputationDelta: { target: "mary-jane", amount: 8 },
          },
          {
            id: "practical",
            text: "I'm careful. Have you heard anything worth knowing?",
            nextNodeId: "info-response",
          },
        ],
      },
      "flirt-response": {
        id: "flirt-response",
        speaker: "Mary Jane",
        text: "(She looks away, trying not to smile.) Just get home safe, Clipper.",
        choices: [{ id: "end", text: "[End conversation]", nextNodeId: null }],
      },
      "info-response": {
        id: "info-response",
        speaker: "Mary Jane",
        text:
          "Only that a stranger's been paying good coin for old stories about King Zaza. Might be worth listening in.",
        choices: [
          {
            id: "end2",
            text: "Good to know. Thank you.",
            nextNodeId: null,
            questFlag: "stranger-rumor-heard",
          },
        ],
      },
    },
  },
  "kenny-mousse-intro": {
    npcId: "kenny-mousse",
    startNodeId: "start",
    nodes: {
      start: {
        id: "start",
        speaker: "Kenny Mousse",
        text:
          "My old man's got the finest Haze plants this side of Kushtar. Shame nobody 'round here's got the coin to pay what they're worth.",
        choices: [
          {
            id: "sympathize",
            text: "That sounds rough. Hang in there.",
            nextNodeId: null,
            reputationDelta: { target: "mousse", amount: 5 },
          },
          { id: "end", text: "[End conversation]", nextNodeId: null },
        ],
      },
    },
  },
  "steven-jungleboy-intro": {
    npcId: "steven-jungleboy",
    startNodeId: "start",
    nodes: {
      start: {
        id: "start",
        speaker: "Steven Jungleboy",
        text:
          "Been out harvesting since sunrise. Rich folks want their gardens perfect, but nobody thanks the hands that do the work.",
        choices: [{ id: "end", text: "[End conversation]", nextNodeId: null }],
      },
    },
  },
  "emily-cookies-intro": {
    npcId: "emily-cookies",
    startNodeId: "start",
    nodes: {
      start: {
        id: "start",
        speaker: "Emily Cookies",
        text:
          "Oh — I didn't see you there. My father says a judge's daughter shouldn't be seen chatting in the street. But... maybe just this once.",
        choices: [
          {
            id: "chat",
            text: "Just this once, then.",
            nextNodeId: null,
            reputationDelta: { target: "cookies", amount: 5 },
          },
          { id: "end", text: "[End conversation]", nextNodeId: null },
        ],
      },
    },
  },
  "jeremias-blunt-intro": {
    npcId: "jeremias-blunt",
    startNodeId: "start",
    nodes: {
      start: {
        id: "start",
        speaker: "Jeremias Blunt",
        text:
          "Ah, another admirer? I'd love to chat, but the city doesn't guard itself. Try to keep up if you ever pick up a blade.",
        choices: [{ id: "end", text: "[End conversation]", nextNodeId: null }],
      },
    },
  },
  "olaf-kush-intro": {
    npcId: "olaf-kush",
    startNodeId: "start",
    nodes: {
      start: {
        id: "start",
        speaker: "Olaf Kush",
        text: "...Oh. Didn't hear you come up. I was just... thinking. About stuff. You want something, or you just gonna stand there?",
        choices: [
          {
            id: "leave-be",
            text: "Just passing through.",
            nextNodeId: null,
          },
          { id: "end", text: "[End conversation]", nextNodeId: null },
        ],
      },
    },
  },
  "bobby-johnson-intro": {
    npcId: "bobby-johnson",
    startNodeId: "start",
    nodes: {
      start: {
        id: "start",
        speaker: "OG Bobby Johnson",
        text:
          "Well well. Another face come to admire the legend. Careful — charm this potent's been known to cause fainting.",
        choices: [
          {
            id: "eye-roll",
            text: "(Roll your eyes.)",
            nextNodeId: null,
          },
          { id: "end", text: "[End conversation]", nextNodeId: null },
        ],
      },
    },
  },
};
