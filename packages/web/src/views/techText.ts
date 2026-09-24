/**
 * Tech card text, for players who cannot read the card image.
 *
 * The gamedata spreadsheet (`Civilization/Moderator/gamedata-faf-waw.xlsx`,
 * mirrored in `old-civ-rest`) has a "Description" column for every tech, but
 * it was never filled in there — `TechItem.description` is always `null` for
 * a tech. This is transcribed instead from the tech reference sheet the old
 * client already shipped and still ships today:
 * `packages/web/public/help/Civ_Tech_FF-WW.-2.jpg`. That sheet is the closest
 * thing to a rules reference for what each tech does, so it is quoted here
 * rather than invented. Obvious scan typos ("dscarding", "choie") are
 * corrected; wording and effects are not.
 *
 * Space Flight has no entry on that sheet (Java added it in code, not from
 * the spreadsheet — see `gamedata.ts`); its line below is the human's own
 * text, not a transcription of anything printed.
 */
export const TECH_TEXT: Readonly<Record<string, string>> = {
  'Animal Husbandry':
    'Once per battle, heal up to a total of 3 wounds from your units in play. ' +
    'Wheat — City Management: one of your cities produces an extra three production this turn. ' +
    'Unlocks: The Hanging Gardens.',
  Agriculture: 'Immediately grow your capital into a metropolis.',
  'Code of Laws':
    'Once per turn, after you win a battle, add 1 coin to this token (max 4). ' +
    'Unlocks: the Republic government, the Trading Post building, The Oracle.',
  Currency: 'Incense — City Management: gain three culture. Unlocks: the Market building, Chichen Itza.',
  'Horseback Riding':
    'Silk — Trade: gain 9 trade. Another player of your choice then gains 6 trade. Unlocks: travel speed 3.',
  Masonry:
    'You may build City Walls in your cities for 7 production, shown by flipping the city marker to its ' +
    'walled side. Unlocks: a stacking limit of 3, The Great Wall.',
  Metalworking:
    'Iron — Battle: when playing a unit from hand, add 3 to the attack of its strength. ' +
    'Unlocks: the Barracks building, The Colossus.',
  Navigation: 'You may cross water, but you may not end your movement in it. Unlocks: the Harbor building.',
  Philosophy: 'Any 3 — City Management: gain a random great person. Unlocks: the Temple building, Angkor Wat.',
  Pottery:
    'Any 2 — City Management: add 1 coin token to this tech (max 4). ' +
    'Unlocks: +1 hand size, the Granary building, The Pyramids.',
  Writing:
    'Spy — City Management: cancel a city action being performed by another player ' +
    '(may not cancel resource abilities). Unlocks: the Library building.',
  Navy:
    'Each time you build an army with a city action, you may place that unit in the outskirts of a city ' +
    'with a shipyard. Unlocks: the Shipyard building.',

  'Civil Service': 'Spy — Any Time: cancel a culture event. Unlocks: 1 coin, +1 hand size.',
  Chivalry:
    'Incense — City Management: gain 5 culture. ' +
    'Unlocks: the Feudalism government, Level II Mounted units, Taj Mahal.',
  Construction:
    'Wheat — City Management: one of your cities produces an extra 5 production this turn. ' +
    'Unlocks: the Workshop building, Porcelain Tower.',
  Democracy:
    'Once per turn, you may spend 6 trade during City Management to add 1 coin token to this tech (max 4). ' +
    'Unlocks: the Democracy government, Level II Infantry units.',
  Engineering:
    'Once per turn, when spending production from a city, you may split the production to purchase two ' +
    'items instead of only one. Unlocks: the Aqueduct building, Panama Canal.',
  Irrigation: 'Raises your maximum number of cities to 3. Unlocks: Machu Picchu.',
  Mathematics:
    'Iron — Battle: while involved in a battle, deal up to 3 wounds, spread across enemy units however ' +
    'you choose. Unlocks: Level II Artillery units.',
  Monarchy:
    'Silk — City Management: obsolete 1 ancient wonder, or kill 1 random unit from another player’s ' +
    'standing forces. Unlocks: the Monarchy government, Himeji Samurai Castle.',
  Mysticism:
    'When you draw a culture event card, draw an extra card from that deck, keeping one and discarding the ' +
    'other. Spy — City Management: force an opponent to discard a coin token of your choice.',
  'Printing Press':
    'Once per turn, you may spend 5 culture during City Management to add 1 coin token to this tech (max 4). ' +
    'Unlocks: a stacking limit of 4, the University building, The Louvre.',
  Sailing: 'You may cross or end your movement in water. Unlocks: movement speed 4.',
  Logistics: 'Unlocks: Level II Infantry, Level II Artillery and Level II Mounted units.',
  Bureaucracy:
    'Once per turn, you may switch one of your social policies during research. Unlocks: 1 coin.',

  Banking:
    'Wheat — City Management: one of your cities produces an extra 7 production this turn. ' +
    'Unlocks: the Bank building, Big Ben.',
  Biology: 'Once per battle, heal all wounds from your units in play. Unlocks: a stacking limit of 5.',
  Communism:
    'Spy — Movement: choose a square. No figure may leave that square this turn. This may interrupt a ' +
    'figure’s movement. Unlocks: the Communism government, The Kremlin.',
  Ecology:
    'Advancing on the culture track costs you 1 less trade for every 3 coins you possess. ' +
    'Wheat — Start of Turn: change an empty non-mountain square into a different non-mountain square for ' +
    'the rest of the game.',
  Gunpowder:
    'Any 2 — City Management: obsolete an ancient or medieval wonder, or destroy a building of your choice. ' +
    'Unlocks: Level III Infantry units.',
  'Metal Casting':
    'Incense — City Management: gain 7 culture. Unlocks: Level III Artillery units, Statue of Liberty.',
  'Military Science':
    'Your cities each produce 1 extra production for every 3 coins you possess. Unlocks: the Academy building.',
  Railroad: 'Unlocks: the Iron Mine building, 1 coin, Level III Mounted units.',
  'Steam Power':
    'You may cross or end your movement in water. Silk — City Management: move all of your figures in one ' +
    'square to any water square on the map; those figures may not move again this turn. ' +
    'Unlocks: travel speed 5.',
  Theology: 'Unlocks: the Fundamentalism government, +1 hand size, the Cathedral building.',
  Education:
    'Once per turn, when you build a wonder, add one coin to this tech (max 4). ' +
    '4 resources (1 of each) — City Management: learn a new tech of your choice for free.',

  'Atomic Theory':
    'Nuke — City Management: take an extra action with each of your cities. ' +
    'Nuke — Movement: nuke a non-capital city. The city, along with all buildings, wonders, figures and ' +
    'great people in its outskirts, is destroyed.',
  Ballistics:
    'Iron — Battle: while involved in a battle, deal up to 6 wounds, spread across enemy units however ' +
    'you choose. Unlocks: Level IV Artillery units.',
  Combustion:
    'Once per turn, when one of your armies ends its movement on a building, destroy that building. If one ' +
    'of your armies attacks a city with walls, the walls are destroyed before the battle. ' +
    'Unlocks: Level IV Mounted units.',
  Computers:
    'Your battle and culture hand sizes are increased by 1 for every 5 coins you possess. Unlocks: 1 coin.',
  Flight:
    'You may cross or end your movement in water. You may also ignore enemy figures, huts, villages and ' +
    'cities when moving. Unlocks: Aircraft units, travel speed 6.',
  'Mass Media':
    'Your culture events cannot be canceled, regardless of other game effects. Spy — Any Time: cancel a ' +
    'resource ability; the resources spent to activate that ability are lost. Unlocks: Cristo Redentor.',
  Plastics:
    'Start of turn: once per turn, build a unit, figure or building you’ve unlocked for free. ' +
    'Wheat — City Management: one of your cities produces an extra 10 production this turn.',
  'Replacement Parts': 'Unlocks: a stacking limit of 6, Level IV Infantry units.',

  'Space Flight': 'Immediately win the game with a Tech victory.',
}
