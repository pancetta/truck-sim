// All UI text, German only (spec #1).
export const strings = {
  wheel: 'Lenkrad',
  gas: 'Gas',
  brake: 'Bremse',
  rotate: 'Bitte Gerät drehen',
  camera: 'Kamera',
  kmh: 'km/h',
  gear: 'Gang',
  rpm: 'U/min',
  rpmScale: 'U/min × 100', // under the cab's RPM dial
  resetToRoad: 'Zurück auf die Straße',
  money: 'Kontostand',
  orders: 'Aufträge',
  accept: 'Annehmen',
  activeOrder: 'Aktiver Auftrag',
  toPickup: 'Fahrt zur Beladestelle',
  toDropoff: 'Fahrt zur Entladestelle',
  stopToLoad: 'Zum Beladen in der markierten Zone anhalten',
  stopToUnload: 'Zum Entladen in der markierten Zone anhalten',
  stopToDock: 'Zum Entladen rückwärts und gerade an die Rampe setzen',
  loading: 'Wird beladen…',
  unloading: 'Wird entladen…',
  paid: 'Bezahlt',
  payLines: { base: 'Grundlohn', time: 'Zeitbonus', fragile: 'Zerbrechlich-Prämie', perishable: 'Frische-Prämie', delicate: 'Sorgfalts-Prämie', live: 'Tierwohl-Prämie', dock: 'Rampenbonus', night: 'Nachtzuschlag', rain: 'Regenzuschlag', umweg: 'Umweg' }, // state.lastPayment line labels
  // The surprise notice (state.lastSurprise): a street closed ahead (then its name), or the Client's call (then the new place and the Umweg pay).
  surprises: { closed: 'Straße voraus gesperrt', newRoute: 'neue Route', dropoff: 'Anruf vom Kunden: bitte nach' },
  offerTypes: { normal: 'Normal', heavy: 'Schwerlast', fragile: 'Zerbrechlich', dock: 'Rampe', fragileDock: 'Zerbrechlich · Rampe', express: 'Express', oversized: 'Übergröße', round: 'Tour', pedestrian: 'Fußgängerzone' },
  // What is special about an offer of each type, on its line in the orders panel.
  offerTags: {
    normal: 'Hinfahren, abladen, fertig',
    heavy: 'Schwere Ladung, längerer Bremsweg',
    fragile: 'Sanft bremsen, sonst leidet die Ladung',
    dock: 'Rückwärts an die Rampe',
    fragileDock: 'Sanft bremsen, dann rückwärts an die Rampe',
    express: 'Knappe Zeit, dafür mehr Lohn',
    oversized: 'Zu breit für Gassen: Route nur über breite Straßen',
    round: 'Mehrere Entladestellen nacheinander, jede zahlt ihren Teil',
    pedestrian: 'Nur mit dem Dreirad: zwischen den Pollern hindurch',
  },
  // Cargo kinds (tables.orders.kinds): the name and meter in the goal banner while one is loaded, and the twist at the
  // end of an offer's tag line (fragile has its own offer type, which says it).
  cargoKinds: {
    fragile: { name: 'Zerbrechlich', meter: 'Schaden' },
    perishable: { name: 'Frischware', meter: 'Wärme', twist: 'Frischware: die Prämie schrumpft mit jeder Minute' },
    delicate: { name: 'Empfindlich', meter: 'Schaden', twist: 'Empfindlich: sanft lenken und bremsen, nirgends anstoßen' },
    live: { name: 'Lebende Fracht', meter: 'Stress', twist: 'Lebende Fracht: sanft anfahren und sanft bremsen' },
  },
  expectedTime: 'Soll-Zeit',
  bonusTime: 'Bonuszeit',
  rank: 'Rang',
  // The Stars of a delivery (state.lastPayment.stars) and why one was missed: these reasons, else a fine reason's text.
  stars: { delivered: 'Geliefert', onTime: 'Pünktlich', clean: 'Sauber gefahren', dock: 'Rampe' },
  starReasons: { late: 'Zu spät', damage: 'Ladung hat gelitten', notDocked: 'Nicht an der Rampe' },
  km: 'km',
  distance: 'Gesamtstrecke',
  clock: 'Uhrzeit',
  timePlayed: 'Spielzeit',
  rankTitles: ['Aushilfsfahrer', 'Kurierfahrer', 'Berufskraftfahrer', 'Fernfahrer', 'Speditionsprofi', 'Tourenmeister', 'Stadtkenner', 'Straßenlegende'],
  werkstatt: 'Werkstatt',
  close: 'Schließen',
  buy: 'Kaufen',
  level: 'Stufe',
  maxLevel: 'Höchste Stufe',
  from: 'ab',
  upgrades: { motor: 'Motor', brakes: 'Bremsen', tyres: 'Reifen', suspension: 'Fahrwerk', cargoBed: 'Ladefläche', tank: 'Tank' },
  effects: { motor: 'Drehmoment', brakes: 'Bremskraft', tyres: 'Lenkung bei Tempo', suspension: 'Seitenneigung', cargoBed: 'Ladung bis', tank: 'Tankinhalt' },
  // The Vehicles (tables.fleet) by id, and the Werkstatt's words for them.
  fleet: { truck: 'Lkw', van: 'Transporter', dreirad: 'Dreirad' },
  fahrzeuge: 'Fahrzeuge',
  choose: 'Fahren',
  current: 'Im Einsatz',
  litres: 'l',
  looksTruckOnly: 'Aussehen gibt es nur für den Lkw',
  // Why buyUpgrade(), buyVehicle(), chooseVehicle(), buyVisual(), equipVisual(), buyService() or sleep() refused, by its
  // reason.
  refusals: {
    notIdle: 'Nur im Stand ohne Auftrag',
    notAtHome: 'Nur zu Hause',
    noMoney: 'Nicht genug Geld',
    rankTooLow: 'Rang zu niedrig',
    maxLevel: 'Höchste Stufe schon erreicht',
    unknown: 'Unbekannter Artikel',
    owned: 'Schon gekauft',
    notOwned: 'Noch nicht gekauft',
    moving: 'Erst anhalten', // buyService()
    busy: 'Läuft schon',
  },
  technik: 'Technik',
  looks: 'Aussehen',
  visualSlots: { paint: 'Lack', livery: 'Design', lightBar: 'Dachleuchten', gimmick: 'Glücksbringer', rims: 'Felgen', chrome: 'Chrom' },
  visuals: {
    paintStock: 'Werkslack',
    paintBlue: 'Ozeanblau',
    paintGreen: 'Tannengrün',
    paintRed: 'Feuerrot',
    paintNight: 'Nachtschwarz',
    liveryNone: 'Ohne',
    liveryStripes: 'Zierstreifen',
    liveryChevrons: 'Pfeile',
    liveryChecker: 'Karoband',
    liveryZigzag: 'Blitz',
    lightBarNone: 'Ohne',
    lightBarBeacons: 'Rundumleuchten',
    lightBarSpots: 'Scheinwerferbügel',
    gimmickNone: 'Ohne',
    gimmickDice: 'Plüschwürfel',
    gimmickFigure: 'Wackelfigur',
    rimsStock: 'Serie',
    rimsChrome: 'Chromfelgen',
    rimsRed: 'Rote Felgen',
    rimsStar: 'Sternfelgen',
    chromeNone: 'Ohne',
    chromeBumpers: 'Chromstoßstangen',
    chromeBullBar: 'Frontbügel',
  },
  resetSave: 'Spielstand zurücksetzen',
  resetConfirm: 'Spielstand wirklich zurücksetzen? Geld, Rang und Upgrades gehen verloren.',
  fine: 'Bußgeld',
  redLight: 'Rote Ampel', // a fine reason (state.lastFine.reason)
  collision: 'Unfall', // a fine reason
  speeding: 'Zu schnell', // a fine reason
  giveWay: 'Vorfahrt missachtet', // a fine reason
  stopSign: 'Stoppschild missachtet', // a fine reason
  zebra: 'Zebrastreifen missachtet', // a fine reason
  zebraAhead: 'Zebrastreifen', // HUD, while a zebra crossing is near (state.zebraAhead)
  policeSees: 'Polizei sieht dich', // HUD, while a police car sees the truck
  policeLettering: 'POLIZEI', // on the police cars' sides
  speedLimit: 'Höchstgeschwindigkeit', // HUD, the sign with state.speedLimit
  street: 'Straße', // HUD, the name of the street the truck is on (state.street)
  fuel: 'Tank', // the fuel gauge, in the HUD and the cab
  fuelLow: 'Tank fast leer', // HUD, below tables.fuel.low
  energy: 'Energie', // the driver's energy gauge, in the HUD's status strip
  tired: 'Müde: Zeit für eine Pause', // HUD, below tables.energy.tired
  exhausted: 'Erschöpft: Lenken und Bremsen träge', // HUD, below tables.energy.exhausted
  services: { fuel: 'Tanken', snack: 'Snack', meal: 'Essen', sleep: 'Schlafen' }, // what a service spot sells (state.serviceOffer), on its buttons
  serving: { fuel: 'Wird getankt…', snack: 'Kurze Pause…', meal: 'Beim Essen…' }, // the running stop's progress bar
  towed: 'Tank leer, abgeschleppt zu', // the tow notice, then the station and the fee
  rules: { light: 'Ampel', rightBeforeLeft: 'Rechts vor links', priority: 'Vorfahrtstraße', giveWay: 'Vorfahrt achten', stop: 'Stop' }, // HUD, the next junction's rule (state.junctionRule)
};
