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
  payLines: { base: 'Grundlohn', time: 'Zeitbonus', fragile: 'Zerbrechlich-Prämie', perishable: 'Frische-Prämie', delicate: 'Sorgfalts-Prämie', live: 'Tierwohl-Prämie', dock: 'Rampenbonus', night: 'Nachtzuschlag', rain: 'Regenzuschlag', umweg: 'Umweg', story: 'Belohnung' }, // state.lastPayment line labels
  // The surprise notice (state.lastSurprise): a street closed ahead (then its name), or the Client's call (then the new place and the Umweg pay).
  surprises: { closed: 'Voraus gesperrt', newRoute: 'neue Route', dropoff: 'Anruf vom Kunden: bitte nach' },
  offerTypes: { normal: 'Normal', heavy: 'Schwerlast', fragile: 'Zerbrechlich', dock: 'Rampe', fragileDock: 'Zerbrechlich · Rampe', express: 'Express', oversized: 'Übergröße', round: 'Tour', pedestrian: 'Fußgängerzone', schwertransport: 'Schwertransport' },
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
    schwertransport: 'Nur mit dem Schwerlaster: Riesenlast, Route nur über breite Straßen',
  },
  // Cargo kinds (tables.orders.kinds): the name and meter in the goal banner while one is loaded, and the twist at the
  // end of an offer's tag line (fragile has its own offer type, which says it).
  cargoKinds: {
    fragile: { name: 'Zerbrechlich', meter: 'Schaden' },
    perishable: { name: 'Frischware', meter: 'Wärme', twist: 'Frischware: die Prämie schrumpft mit jeder Minute' },
    delicate: { name: 'Empfindlich', meter: 'Schaden', twist: 'Empfindlich: sanft lenken und bremsen, nirgends anstoßen' },
    live: { name: 'Lebende Fracht', meter: 'Stress', twist: 'Lebende Fracht: sanft anfahren und sanft bremsen' },
  },
  // What sort of place a spot is (tables.osm.spots' `kind`), shown with a Client on its offers.
  spotKinds: { depot: 'Spedition', bakery: 'Bäckerei', warehouse: 'Lager', shop: 'Laden', cellar: 'Weinkeller', workshop: 'Handwerk', grocer: 'Feinkost', florist: 'Blumenladen', cafe: 'Café', station: 'Tankstelle', trattoria: 'Trattoria', home: 'Zuhause' },
  // Reputation (tables.reputation): on offers, its level's name; the notice when it rises (state.lastReputation) quotes the
  // Client's thank-you line, by its kind (only kinds that take orders have one).
  reputation: 'Ruf',
  reputationLevels: ['Neu', 'Bekannt', 'Geschätzt', 'Vertraut', 'Unverzichtbar'],
  thanks: {
    depot: 'Pünktlich wie ein Uhrwerk. So arbeiten wir gern!',
    bakery: 'Für Sie liegt ab jetzt immer ein Cornetto bereit!',
    warehouse: 'Sauber geliefert, sauber gestapelt. Danke!',
    shop: 'Unsere Kundschaft fragt schon nach Ihnen. Grazie!',
    cellar: 'Darauf stoßen wir an. Salute!',
    workshop: 'Auf Sie ist Verlass. Danke für die gute Arbeit!',
    grocer: 'Frisch und pünktlich, so mögen wir das. Grazie mille!',
    florist: 'Die Blumen strahlen, und wir auch. Danke!',
    cafe: 'Der nächste Espresso geht aufs Haus!',
  },
  // Story chains (tables.stories): their words in the orders panel and notices (state.lastStory), then each chain's
  // title, the line its Client says as it starts (`intro`), and per step the line on its offer and the thank-you once
  // it is delivered (the last one's closes the chain).
  story: { label: 'Geschichte', part: 'Teil', started: 'Neue Geschichte', done: 'Geschichte abgeschlossen', next: 'Als Nächstes' },
  stories: {
    geburtstag: {
      title: 'Nonna Ottavias Hundertster',
      intro: 'Meine Nonna wird hundert! Ich backe für die ganze Nachbarschaft, aber allein schaffe ich das nie. Helfen Sie mir?',
      steps: [
        {
          offer: 'Hundert Einladungen, eine für jede Kerze. Bitte in alle Läden: Nonna kennt wirklich jeden.',
          thanks: 'Alle eingeladen! Einer hat vor Freude geweint. Oder war das die Zwiebel in seiner Hand?',
        },
        {
          offer: 'Eine Probetorte fürs Café. Die Chefin dort ist die strengste Kuchenrichterin der Stadt.',
          thanks: 'Sie hat zwei Stücke gegessen. Bei ihr heißt das: Weltklasse!',
        },
        {
          offer: 'Oje, die Kerzen! Der Blumenladen schmückt schon den Saal und wartet. Schnell, schnell!',
          thanks: 'Gerade noch rechtzeitig. Sonst hätte ich hundert Streichhölzer anzünden müssen.',
        },
        {
          offer: 'Die große Torte: sieben Stockwerke, obendrauf eine Nonna aus Marzipan. Bitte ganz, ganz sanft!',
          thanks: 'Nonna hat alle hundert Kerzen auf einmal ausgepustet und sagt, Sie fahren schöner als ihr Mann früher mit dem Eselskarren. Ihr größtes Lob!',
        },
      ],
    },
    giesskanne: {
      title: 'Die Goldene Gießkanne',
      intro: 'Der Wettbewerb um die blühendste Straße beginnt! Die Goldene Gießkanne gehört dieses Jahr uns. Sind Sie dabei?',
      steps: [
        {
          offer: 'Sonnenblumen für die Tische im Café. Wer neben Sonnenblumen Kaffee trinkt, lächelt doppelt.',
          thanks: 'Das Café sieht aus wie ein Sommertag. Sogar der Kater auf der Fensterbank strahlt.',
        },
        {
          offer: 'Blumenkästen für alle Läden. Ein Laden ohne Blumen ist wie ein Witz ohne Pointe.',
          thanks: 'Jeder Laden blüht! Nur ein Kaktus schmollt, weil er nicht mitfahren durfte.',
        },
        {
          offer: 'Eine Riesenorchidee für die Werkstatt, damit es dort nach Blumen duftet statt nach Leim. Sie ist empfindlich wie eine Opernsängerin: kein Ruckeln!',
          thanks: 'Die Diva ist heil angekommen und duftet jetzt zwischen den Hobelspänen. Alle sind verzaubert.',
        },
        {
          offer: 'Die Jury frühstückt beim Bäcker! Unser Siegergesteck muss sofort hin, bevor die Croissants alle sind.',
          thanks: 'Gewonnen! Die Goldene Gießkanne ist unser! Ab heute gieße ich nur noch mit ihr. Und Sie bekommen den Ehrenplatz auf dem Siegerfoto!',
        },
      ],
    },
    espressomat: {
      title: 'Zitas Wundermaschine',
      intro: 'Ich bin Zita und erfinde den Espressomat 3000: Espresso für die ganze Straße, auf Knopfdruck! Na ja, bald. Fahren Sie für mich?',
      steps: [
        {
          offer: 'Den Bauplan ins Café: Die Chefin soll mir sagen, wie viel Espresso die Straße wirklich trinkt.',
          thanks: 'Ihre Antwort: unendlich viel. Ich brauche einen größeren Kessel!',
        },
        {
          offer: 'Der erste Prototyp, für einen Test beim Bäcker. Vorsicht, er ist aus Glas und Hoffnung.',
          thanks: 'Er hat gepfiffen, gedampft und … Kakao gemacht. Der Bäcker war trotzdem begeistert.',
        },
        {
          offer: 'Testtassen für die Läden. Wer probiert, darf ehrlich sein. Na gut: nett ehrlich.',
          thanks: 'Das Urteil: „zu stark“, „zu schwach“, „mehr davon!“. Ich nehme das als Ja.',
        },
        {
          offer: 'Er ist fertig! Der Espressomat 3000 muss ins Café, bevor die Eröffnung beginnt. Bitte keine Schlaglöcher!',
          thanks: 'Er läuft! Er pfeift ein Lied und macht den besten Espresso der Stadt. Zum Dank habe ich Ihre Stoßstangen verchromt.',
        },
      ],
    },
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
  fleet: { truck: 'Lkw', van: 'Transporter', dreirad: 'Dreirad', lorry: 'Schwerlaster' },
  fahrzeuge: 'Fahrzeuge',
  choose: 'Fahren',
  current: 'Im Einsatz',
  litres: 'l',
  looksTruckOnly: 'Aussehen gibt es nur für den Lkw',
  // The truck's trailer (#96), in the Werkstatt's Technik tab, and the HUD's notice while it is jackknifed.
  trailer: 'Anhänger',
  trailerLoad: 'Ladung',
  hitch: 'Ankuppeln',
  unhitch: 'Abkuppeln',
  hitched: 'angekuppelt',
  unhitched: 'abgekuppelt',
  jackknifed: 'Anhänger eingeknickt: vorwärts geradeziehen',
  // Why buyUpgrade(), buyVehicle(), chooseVehicle(), buyTrailer(), hitchTrailer(), buyVisual(), equipVisual(),
  // buyService() or sleep() refused, by its reason.
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
    notTruck: 'Nur für den Lkw', // the trailer
    noRoom: 'Kein Platz hinter dem Lkw', // hitchTrailer()
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
  // The start screen (#112) and its pages; the in-game Menü button opens it.
  start: {
    menu: 'Menü',
    continue: 'Weiterspielen',
    newGame: 'Neues Spiel',
    newGameConfirm: 'Neues Spiel beginnen? Der Spielstand mit Geld, Rang und Fahrzeugen wird ersetzt.',
    map: 'Karte',
    mapLocked: 'Bald verfügbar',
    howTo: 'Anleitung',
    settings: 'Einstellungen',
    credits: 'Credits',
    back: 'Zurück',
    replayTutorial: 'Tutorial erneut spielen',
    // The how-to-play pages (#113), in order, each with its drawing (start.js HOW_TO_ART, by the same key).
    howToPages: {
      controls: {
        title: 'Steuerung',
        text: [
          'Links lenkst du: Leg den Finger auf das Lenkrad und dreh es. Rechts sind Gas und Bremse.',
          'Steht der Lkw und du hältst die Bremse gedrückt, fährt er rückwärts. Lässt du los, bremst er.',
          'Am Berg hält der Lkw kurz von selbst, wenn du von der Bremse gehst. Voll beladen fährt er bergauf langsam an.',
          '„Kamera“ wechselt zwischen der Sicht von hinten und dem Platz im Führerhaus. Steckst du fest, hilft „Zurück auf die Straße“. „Menü“ hält das Spiel an.',
        ],
      },
      orders: {
        title: 'Aufträge und Sterne',
        text: [
          'Unter „Aufträge“ suchst du dir einen Auftrag aus: mit Ladung, Weg, Bezahlung und Soll-Zeit.',
          'Folge dem Pfeil zur Beladestelle und halte in der markierten Zone, bis alles geladen ist. Dann bringst du die Ladung zur Entladestelle.',
          'Jede Lieferung bringt Sterne: einen fürs Liefern, einen für pünktlich und einen für sauber, ohne Bußgeld, Unfall oder kaputte Ladung. Rückwärts an die Rampe gibt es noch einen.',
          'Mit Sternen steigst du im Rang auf. Dann kommen neue Aufträge: schwere, zerbrechliche, eilige, Touren mit mehreren Stopps und mehr.',
        ],
      },
      traffic: {
        title: 'Verkehrsregeln und Polizei',
        text: [
          'Unten rechts zeigen Schilder das Tempolimit und die Regel der nächsten Kreuzung.',
          'Bei Rot hältst du an der Haltlinie. Bei „Vorfahrt achten“ fahren die anderen zuerst, am Stoppschild hältst du vorher ganz an. Ohne Schild gilt rechts vor links.',
          'Ist jemand auf dem Zebrastreifen, lass ihn hinüber. Fahr nicht auf den Gehweg, wo Leute gehen.',
          'Sieht dich die Polizei (das Auge), kostet ein Verstoß Bußgeld. Fährst du ein Auto an, kostet das immer etwas. Die anderen Autos halten Abstand und machen dir Platz.',
        ],
      },
      fuel: {
        title: 'Tank, Energie und Zuhause',
        text: [
          'Fahren braucht Diesel, bergauf mehr. An der Tankstelle hältst du in der Zone und tankst. Ist der Tank leer, wirst du abgeschleppt, und das kostet.',
          'Fahren macht müde: Die Energie oben sinkt. Ein Snack an der Tankstelle hilft ein wenig, ein Essen im Restaurant ganz.',
          'Zuhause schläfst du bis zum Morgen. Nachts ist weniger Verkehr, und Lieferungen bringen einen Zuschlag. Bei Regen auch, aber dann rutscht der Lkw leichter.',
        ],
      },
      werkstatt: {
        title: 'Werkstatt, Fahrzeuge und Anhänger',
        text: [
          'Die Werkstatt ist Zuhause. Sie öffnet, wenn du dort ohne Auftrag in der Zone stehst.',
          'Technik macht dein Fahrzeug besser: Motor, Bremsen, Reifen, Fahrwerk, Ladefläche und Tank. Für den Lkw gibt es auch Aussehen, vom Lack bis zum Glücksbringer.',
          'Mit höherem Rang kaufst du neue Fahrzeuge: den flinken Transporter, das kleine Dreirad für die Fußgängerzonen und den großen Schwerlaster. Gewechselt wird Zuhause.',
          'Der Lkw kann einen Anhänger ziehen: für größere, besser bezahlte Ladungen. Knickt er beim Rückwärtsfahren ein, fahr vorwärts, bis er wieder gerade ist.',
        ],
      },
      clients: {
        title: 'Kunden und Geschichten',
        text: [
          'Jeder Auftrag kommt von einem Kunden. Mit jedem Stern, den du bei ihm verdienst, wächst dein Ruf: Das zeigen die Herzen.',
          'Kunden, die dich kennen, zahlen mehr und haben öfter Aufträge für dich.',
          'Bist du für einen Kunden unverzichtbar, erzählt er dir seine Geschichte: mehrere Aufträge nacheinander, mit einer Belohnung am Ende.',
          'Unterwegs kann sich etwas ändern: Eine Straße wird gesperrt, oder der Kunde will die Ladung woanders hin. Der Pfeil zeigt dir dann den neuen Weg.',
        ],
      },
    },
    next: 'Weiter',
    creditsIntro: 'Truck Sim ist ein eigenständiges Spiel. Es nutzt diese freien Daten und Werke:',
    creditsOwn: 'Alles andere, vom Programm über Fahrzeuge und Gebäude bis zu den Bildern, ist eigene Arbeit von Truck Sim.',
  },
  // The guided first delivery (#113): its card's label, buttons and each step's text (tables.tutorial.steps); a step with
  // `next` waits for that button, the others for what they ask.
  tutorial: {
    label: 'Tutorial',
    skip: 'Überspringen',
    steps: {
      drive: { text: 'Willkommen! Lenk links mit dem Lenkrad und drück rechts auf Gas. Fahr ein Stück die Straße entlang. Keine Sorge: Im Tutorial gibt es keine Bußgelder.' },
      brake: { text: 'Super! Jetzt drück die Bremse, bis der Lkw ganz steht.' },
      signs: {
        text: 'Oben siehst du deinen Rang, deine Sterne und deine Energie. Unten rechts zeigen Schilder das Tempolimit und wer an der nächsten Kreuzung Vorfahrt hat.',
        next: 'Weiter',
      },
      offers: { text: 'Zeit für deinen ersten Auftrag! Tipp auf „Aufträge“ und nimm einen an.' },
      pickup: { text: 'Folge dem Pfeil oben zur Beladestelle. Dort ist eine Zone auf der Straße markiert.' },
      load: { text: 'Du bist in der Zone! Bleib stehen, bis alles eingeladen ist.' },
      dropoff: { text: 'Geladen! Folge jetzt dem Pfeil zur Entladestelle und halte dort in der Zone, bis alles ausgeladen ist.' },
      reverse: { text: 'Geschafft, deine ersten Sterne! Noch ein Trick: Steht der Lkw, halt die Bremse gedrückt. Dann fährt er rückwärts.' },
      home: {
        text: 'Zuhause, wo du losgefahren bist, ist die Werkstatt. Dort kaufst du mit deinem Geld Technik und neue Fahrzeuge, und dort schläfst du. Mehr steht in der Anleitung im Menü. Gute Fahrt!',
        next: 'Los geht’s',
      },
    },
  },
  maps: { monti: { name: 'Rione Monti', line: 'Enge Gassen und steile Hügel mitten in Rom' } }, // the map cards (tables.maps)
  resetSave: 'Spielstand zurücksetzen',
  resetConfirm: 'Spielstand wirklich zurücksetzen? Geld, Rang und Upgrades gehen verloren.',
  fine: 'Bußgeld',
  redLight: 'Rote Ampel', // a fine reason (state.lastFine.reason)
  collision: 'Unfall', // a fine reason
  speeding: 'Zu schnell', // a fine reason
  giveWay: 'Vorfahrt missachtet', // a fine reason
  stopSign: 'Stoppschild missachtet', // a fine reason
  zebra: 'Zebrastreifen missachtet', // a fine reason
  pedestrian: 'Fußgänger gefährdet', // a fine reason
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
