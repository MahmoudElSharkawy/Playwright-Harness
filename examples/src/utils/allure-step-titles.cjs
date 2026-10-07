/** Keeps stable locator-bearing Allure views without changing native Playwright steps. */
function createAllureStepView() {
  const views = new WeakMap();
  return function allureStep(step) {
    let view = views.get(step);
    if (!view) {
      view = {};
      views.set(step, view);
    }
    const locator = step.params?.locator;
    const appendLocator = ['pw:api', 'expect'].includes(step.category)
      && typeof locator === 'string' && locator.length > 0 && !step.title.endsWith(` ${locator}`);
    Object.assign(view, step, {
      title: appendLocator ? `${step.title} ${locator}` : step.title,
      parent: step.parent ? allureStep(step.parent) : undefined,
    });
    return view;
  };
}

module.exports = {createAllureStepView};
