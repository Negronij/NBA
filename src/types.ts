/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface Team {
  id: string;
  name: string;
  short: string;
  conf: string;
  seed?: string;
}

export interface Match {
  t: [Team | null, Team | null];
  w: [number, number];
}

export interface Round {
  r1: Match[];
  r2: Match[];
  r3: Match[];
}

export interface Bracket {
  east: Round;
  west: Round;
  finals: Match;
}

export interface PredMatch {
  w: [number, number];
}

export interface PredRound {
  r1: PredMatch[];
  r2: PredMatch[];
  r3: PredMatch[];
}

export interface Prediction {
  east: PredRound;
  west: PredRound;
  finals: PredMatch;
}

export type Mode = 'r1' | 'r2' | 'r3' | 'rf' | 'admin' | 'pts';
export type Conf = 'east' | 'west' | 'finals';

export const ALL_TEAMS: Team[] = [
  {id:'ATL',name:'Atlanta Hawks',short:'Hawks',conf:'East'},
  {id:'BOS',name:'Boston Celtics',short:'Celtics',conf:'East'},
  {id:'BKN',name:'Brooklyn Nets',short:'Nets',conf:'East'},
  {id:'CHA',name:'Charlotte Hornets',short:'Hornets',conf:'East'},
  {id:'CHI',name:'Chicago Bulls',short:'Bulls',conf:'East'},
  {id:'CLE',name:'Cleveland Cavaliers',short:'Cavaliers',conf:'East'},
  {id:'DET',name:'Detroit Pistons',short:'Pistons',conf:'East'},
  {id:'IND',name:'Indiana Pacers',short:'Pacers',conf:'East'},
  {id:'MIA',name:'Miami Heat',short:'Heat',conf:'East'},
  {id:'MIL',name:'Milwaukee Bucks',short:'Bucks',conf:'East'},
  {id:'NYK',name:'New York Knicks',short:'Knicks',conf:'East'},
  {id:'ORL',name:'Orlando Magic',short:'Magic',conf:'East'},
  {id:'PHI',name:'Philadelphia 76ers',short:'76ers',conf:'East'},
  {id:'TOR',name:'Toronto Raptors',short:'Raptors',conf:'East'},
  {id:'WAS',name:'Washington Wizards',short:'Wizards',conf:'East'},
  {id:'DAL',name:'Dallas Mavericks',short:'Mavericks',conf:'West'},
  {id:'DEN',name:'Denver Nuggets',short:'Nuggets',conf:'West'},
  {id:'GSW',name:'Golden State Warriors',short:'Warriors',conf:'West'},
  {id:'HOU',name:'Houston Rockets',short:'Rockets',conf:'West'},
  {id:'LAC',name:'LA Clippers',short:'Clippers',conf:'West'},
  {id:'LAL',name:'Los Angeles Lakers',short:'Lakers',conf:'West'},
  {id:'MEM',name:'Memphis Grizzlies',short:'Grizzlies',conf:'West'},
  {id:'MIN',name:'Minnesota Timberwolves',short:'T-Wolves',conf:'West'},
  {id:'NOP',name:'New Orleans Pelicans',short:'Pelicans',conf:'West'},
  {id:'OKC',name:'Oklahoma City Thunder',short:'Thunder',conf:'West'},
  {id:'PHX',name:'Phoenix Suns',short:'Suns',conf:'West'},
  {id:'POR',name:'Portland Trail Blazers',short:'Blazers',conf:'West'},
  {id:'SAC',name:'Sacramento Kings',short:'Kings',conf:'West'},
  {id:'SAS',name:'San Antonio Spurs',short:'Spurs',conf:'West'},
  {id:'UTA',name:'Utah Jazz',short:'Jazz',conf:'West'},
];

export const LOGO_MAP: Record<string, string> = {
  ATL:'ATLANTAHAWKS',BOS:'BOSTONCELTICS',BKN:'BROOKLYNNETS',CHA:'CHARLOTTEHORNETS',
  CHI:'CHICAGOBULLS',CLE:'CLEVELANDCAVALIERS',DET:'DETROITPISTONS',IND:'INDIANAPACERS',
  MIA:'MIAMIHEAT',MIL:'MILWAUKEEBUCKS',NYK:'NEWYORKKNICKS',ORL:'ORLANDOMAGIC',
  PHI:'PHILADELPHIA76ERS',TOR:'TORONTORAPTORS',WAS:'WASHINGTONWIZARDS',
  DAL:'DALLASMAVERICKS',DEN:'DENVERNUGGETS',GSW:'GOLDENSTATEWARRIORS',HOU:'HOUSTONROCKETS',
  LAC:'LACLIPPERS',LAL:'LOSANGELESLAKERS',MEM:'MEMPHISGRIZZLIES',MIN:'MINNESOTATIMBERWOLVES',
  NOP:'NEWORLEANSPELICANS',OKC:'OKLAHOMACITYTHUNDER',PHX:'PHOENIXSUNS',
  POR:'PORTLANDTRAILBLAZERS',SAC:'SACRAMENTOKINGS',SAS:'SANANTONIOSPURS',UTA:'UTAHJAZZ',
};
