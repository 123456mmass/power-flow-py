declare module "plotly.js-dist-min" {
  interface PlotlyStatic {
    newPlot(
      element: HTMLElement,
      data: unknown[],
      layout?: Record<string, unknown>,
      config?: Record<string, unknown>,
    ): Promise<unknown>;
    react(
      element: HTMLElement,
      data: unknown[],
      layout?: Record<string, unknown>,
      config?: Record<string, unknown>,
    ): Promise<unknown>;
    relayout(element: HTMLElement, update: Record<string, unknown>): Promise<unknown>;
    purge(element: HTMLElement): void;
    Plots: { resize(element: HTMLElement): void };
  }
  const Plotly: PlotlyStatic;
  export default Plotly;
}
