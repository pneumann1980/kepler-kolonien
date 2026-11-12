// Kepler-Kolonien – zentrale Typen der Spiel-Engine (pure, ohne I/O)

export type CommanderType = 'LAND' | 'NAVAL' | 'SPACE' | 'NUCLEAR' | 'DIPLOMAT';
export const COMMANDER_TYPES: CommanderType[] = ['LAND', 'NAVAL', 'SPACE', 'NUCLEAR', 'DIPLOMAT'];
export type TerritoryType = 'land' | 'water' | 'moon';

export interface TerritoryDef {
  id: string;
  name: string;
  type: TerritoryType;
  region: string;
  board: 'planet' | 'moon';
  landingSite?: boolean;
  label: [number, number];
  adjacent: string[];
}

export interface RegionDef {
  id: string;
  name: string;
  kind: 'continent' | 'waterColony' | 'lunarColony';
  bonus: number;
}

export interface MapDef {
  id: string;
  name: string;
  territories: TerritoryDef[];
  regions: RegionDef[];
}

export interface TerritoryState {
  owner: string | null;      // Besitzer der Einheiten bzw. der Station
  mods: number;
  commanders: CommanderType[];
  station: boolean;          // Station gehört immer dem owner
  devastated: boolean;
}

export interface PlayerSettings {
  /** Reaktionsregeln light: Kartentyp-ID → automatisch spielen ja/nein (überschreibt Default) */
  autoReact: Record<string, boolean>;
  /** Würfelpolitik Verteidigung */
  defendMax: boolean;
}

export interface Player {
  id: string;
  name: string;
  color: string;
  isBot: boolean;
  botLevel?: number;
  isNeutral?: boolean;
  energy: number;
  hand: string[];            // Karteninstanzen, z. B. "DIP-01#2"
  eliminated: boolean;
  away?: boolean;            // durch Bot vertreten
  settings: PlayerSettings;
}

export type SetupMode = 'quick' | 'classic';

export interface GameConfig {
  years: number;
  setupMode: SetupMode;
  startEnergy: number;
}

export type TurnStep = 'deploy' | 'hire' | 'buy' | 'main' | 'fortify' | 'end';
export const STEP_ORDER: TurnStep[] = ['deploy', 'hire', 'buy', 'main', 'fortify', 'end'];

export interface TurnState {
  player: string;
  step: TurnStep;
  incomeMods: number;        // noch zu verteilende MODs
  boughtCards: boolean;
  invaded: boolean;          // erste Invasion erklärt bzw. Bewegung erfolgt (Ende der VOR-Phase)
  contestedConquests: number;
  bonusAwarded: boolean;
  bonusCardPending: boolean;
  fortifiesLeft: number;
  conqueredLand: number;     // umkämpfte Landgebiete in diesem Zug (Offensivprämie)
}

export interface InvasionMods {
  maxAttackDice?: number;
  attackerExtraD8?: number;  // zusätzliche W8 über die Kommandanten hinaus
  attackerMinD8?: number;    // mindestens so viele W8 (Amphibienlandung)
  attackerAllD8?: boolean;
  attackerNoD8?: boolean;
  defenderAllD8?: boolean;
  defenderBonus?: number;
  defenderMaxLoss1?: boolean;
  immunity?: boolean;
  played: string[];          // Kartentypen, die in dieser Invasion gespielt wurden
}

export interface Invasion {
  attacker: string;
  defender: string | null;
  from: string;
  to: string;
  rolls: number;
  contested: boolean;
  mods: InvasionMods;
  lastAttDice: number;
  lastD8Commanders: CommanderType[];
  awaitingAdvance: boolean;
  deterred?: number;         // Abschreckung: zu zahlende Energie, sonst Abbruch
  earthLanding?: boolean;
  viaCard?: 'earthLanding';
}

export type EffectKind =
  | 'garrison' | 'fieldCommand' | 'harbor' | 'moonBase' | 'seaBlock' | 'neutralZone' | 'ceasefire'
  | 'sanctions' | 'embargo' | 'emp' | 'contaminated' | 'silo' | 'firstStrike' | 'currents'
  | 'bridgehead' | 'earthLanding' | 'tradeOffer';

export interface Effect {
  id: number;
  kind: EffectKind;
  owner: string;
  territory?: string;
  target?: string;           // Spieler
  region?: string;
  /** Ablauf: zu Beginn des Zugs von expiresAtTurnOf, am Zugende (turnEnd) oder dauerhaft */
  expires: { at: 'turnStart' | 'turnEnd'; player: string } | 'permanent';
}

export interface LogEntry {
  seq: number;
  year: number;
  kind: string;              // text | battle | card | conquest | income | bid | score | setup | system
  msg: string;
  player?: string;
  to?: string;               // nur für diesen Spieler sichtbar
  data?: Record<string, unknown>;
}

export interface ScoreLine {
  player: string;
  territories: number;
  regions: number;
  cards: number;
  total: number;
  energy: number;
  units: number;
  rank: number;
}

export type Phase =
  | 'setupClaim' | 'setupReinforce' | 'setupUnits' | 'quickSetup'
  | 'bid' | 'pickSlot' | 'turn' | 'gameOver';

export interface GameState {
  schema: 1;
  version: number;
  mapId: string;
  config: GameConfig;
  seedCommitment: string;
  rng: [number, number, number, number];
  players: Player[];
  seatOrder: string[];
  territories: Record<string, TerritoryState>;
  decks: Record<CommanderType, string[]>;
  discard: string[];
  territoryDecks: Record<TerritoryType, string[]>;
  phase: Phase;
  year: number;
  turnOrder: string[];
  turnIndex: number;
  turn: TurnState | null;
  invasion: Invasion | null;
  bids: Record<string, { amount: number; card?: string }>;
  bidResult: { player: string; amount: number; effective: number }[] | null;
  pickQueue: string[];
  slots: (string | null)[];
  setup: { queue: string[]; index: number; remaining: Record<string, number>; done: string[] } | null;
  effects: Effect[];
  nextEffectId: number;
  log: LogEntry[];
  scores: ScoreLine[] | null;
  winner: string[] | null;
  revealedSeed?: string;
}

export interface Targets {
  territory?: string;
  territory2?: string;
  player?: string;
  deck?: CommanderType;
  placements?: Record<string, number>;
  count?: number;
}

export type UnitMove = { mods: number; commanders: CommanderType[] };

export type Command =
  | { t: 'SetupClaim'; territory: string }
  | { t: 'SetupReinforce'; placements: Record<string, number> }
  | { t: 'SetupUnits'; land: string; diplomat: string; station: string }
  | { t: 'QuickSetup'; placements: Record<string, number>; land: string; diplomat: string; station: string }
  | { t: 'Bid'; amount: number; card?: string }
  | { t: 'PickSlot'; slot: number }
  | { t: 'Deploy'; placements: Record<string, number> }
  | { t: 'HireCommander'; type: CommanderType; territory: string }
  | { t: 'BuildStation'; territory: string }
  | { t: 'BuyCards'; decks: CommanderType[] }
  | { t: 'PlayCard'; card: string; targets?: Targets }
  | { t: 'Invade'; from: string; to: string; move?: UnitMove }
  | { t: 'Attack'; dice?: number; blitz?: boolean; minRemaining?: number; d8?: CommanderType[] }
  | { t: 'Advance'; move: UnitMove }
  | { t: 'Retreat' }
  | { t: 'Deterrence'; pay: boolean }
  | { t: 'ClaimBonusCard'; deck: CommanderType }
  | { t: 'Fortify'; from: string; to: string; move: UnitMove }
  | { t: 'AnswerTrade'; effectId: number; accept: boolean }
  | { t: 'EndPhase' }
  | { t: 'EndTurn' }
  | { t: 'SetAutoReact'; cardType: string; on: boolean }
  | { t: 'SetDefendMax'; on: boolean }
  | { t: 'Resign' };

export class GameError extends Error {}
