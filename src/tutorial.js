// The guided first delivery's card (#113): the step's text, its Weiter button if it waits for one, and Überspringen.
// It marks the body with the step (data-tutorial), so style.css points at what the step is about. Reads the Sim's
// profile.tutorial; changes it only through the Sim's tutorial commands.
export function createTutorial(root, sim, tables, strings) {
  const t = strings.tutorial;
  root.innerHTML = `
    <div class="tutorial" hidden>
      <small></small>
      <p></p>
      <div><button type="button" class="tutorial-next"></button><button type="button" class="tutorial-skip">${t.skip}</button></div>
    </div>`;
  const card = root.querySelector('.tutorial');
  const [count, text] = card.children;
  const next = root.querySelector('.tutorial-next');
  next.addEventListener('click', () => sim.nextTutorial());
  root.querySelector('.tutorial-skip').addEventListener('click', () => sim.skipTutorial());
  let shown; // the step shown, so the card only redraws on a change

  // `away`: something covers play (the Werkstatt), so the card hides until it's back.
  function update(state, away) {
    const step = away ? null : state.profile.tutorial;
    if (step === shown) return;
    shown = step;
    card.hidden = !step;
    if (step) document.body.dataset.tutorial = step;
    else delete document.body.dataset.tutorial;
    if (!step) return;
    const { steps } = tables.tutorial;
    count.textContent = `${t.label} · ${steps.indexOf(step) + 1}/${steps.length}`;
    text.textContent = t.steps[step].text;
    next.hidden = !t.steps[step].next;
    next.textContent = t.steps[step].next ?? '';
  }

  return { update };
}
