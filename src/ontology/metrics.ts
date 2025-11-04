/**
 * Ontology System Metrics
 *
 * Provides Prometheus-style metrics collection for:
 * - Classification performance (latency, throughput, confidence)
 * - Validation results (success rate, errors)
 * - Query performance (latency, result counts)
 * - Cache hit rates
 * - LLM usage and costs
 */

/**
 * Metric types following Prometheus conventions
 */
export interface Counter {
  name: string;
  help: string;
  value: number;
  labels: Record<string, string>;
}

export interface Gauge {
  name: string;
  help: string;
  value: number;
  labels: Record<string, string>;
}

export interface Histogram {
  name: string;
  help: string;
  buckets: number[];
  observations: number[];
  sum: number;
  count: number;
  labels: Record<string, string>;
}

/**
 * OntologyMetrics - Centralized metrics collection
 */
export class OntologyMetrics {
  private counters: Map<string, Counter> = new Map();
  private gauges: Map<string, Gauge> = new Map();
  private histograms: Map<string, Histogram> = new Map();

  constructor() {
    this.initializeMetrics();
  }

  /**
   * Initialize default metrics
   */
  private initializeMetrics(): void {
    // Classification metrics
    this.registerCounter({
      name: 'ontology_classification_total',
      help: 'Total number of classification attempts',
      value: 0,
      labels: {},
    });

    this.registerCounter({
      name: 'ontology_classification_success',
      help: 'Number of successful classifications',
      value: 0,
      labels: {},
    });

    this.registerCounter({
      name: 'ontology_classification_failure',
      help: 'Number of failed classifications',
      value: 0,
      labels: {},
    });

    this.registerHistogram({
      name: 'ontology_classification_duration_seconds',
      help: 'Classification duration in seconds',
      buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
      observations: [],
      sum: 0,
      count: 0,
      labels: {},
    });

    this.registerHistogram({
      name: 'ontology_classification_confidence',
      help: 'Classification confidence scores',
      buckets: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0],
      observations: [],
      sum: 0,
      count: 0,
      labels: {},
    });

    // Validation metrics
    this.registerCounter({
      name: 'ontology_validation_total',
      help: 'Total number of validation attempts',
      value: 0,
      labels: {},
    });

    this.registerCounter({
      name: 'ontology_validation_success',
      help: 'Number of successful validations',
      value: 0,
      labels: {},
    });

    this.registerCounter({
      name: 'ontology_validation_failure',
      help: 'Number of failed validations',
      value: 0,
      labels: {},
    });

    // Query metrics
    this.registerCounter({
      name: 'ontology_query_total',
      help: 'Total number of ontology queries',
      value: 0,
      labels: {},
    });

    this.registerHistogram({
      name: 'ontology_query_duration_seconds',
      help: 'Query duration in seconds',
      buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1],
      observations: [],
      sum: 0,
      count: 0,
      labels: {},
    });

    this.registerHistogram({
      name: 'ontology_query_results',
      help: 'Number of results returned per query',
      buckets: [0, 1, 5, 10, 25, 50, 100, 250, 500],
      observations: [],
      sum: 0,
      count: 0,
      labels: {},
    });

    // Cache metrics
    this.registerCounter({
      name: 'ontology_cache_hits',
      help: 'Number of cache hits',
      value: 0,
      labels: {},
    });

    this.registerCounter({
      name: 'ontology_cache_misses',
      help: 'Number of cache misses',
      value: 0,
      labels: {},
    });

    this.registerGauge({
      name: 'ontology_cache_size',
      help: 'Current cache size',
      value: 0,
      labels: {},
    });

    // LLM usage metrics
    this.registerCounter({
      name: 'ontology_llm_calls_total',
      help: 'Total number of LLM calls',
      value: 0,
      labels: {},
    });

    this.registerCounter({
      name: 'ontology_llm_tokens_prompt',
      help: 'Total prompt tokens used',
      value: 0,
      labels: {},
    });

    this.registerCounter({
      name: 'ontology_llm_tokens_completion',
      help: 'Total completion tokens used',
      value: 0,
      labels: {},
    });

    this.registerHistogram({
      name: 'ontology_llm_duration_seconds',
      help: 'LLM call duration in seconds',
      buckets: [0.1, 0.5, 1, 2, 5, 10],
      observations: [],
      sum: 0,
      count: 0,
      labels: {},
    });
  }

  /**
   * Register a counter metric
   */
  registerCounter(counter: Counter): void {
    const key = this.metricKey(counter.name, counter.labels);
    this.counters.set(key, counter);
  }

  /**
   * Register a gauge metric
   */
  registerGauge(gauge: Gauge): void {
    const key = this.metricKey(gauge.name, gauge.labels);
    this.gauges.set(key, gauge);
  }

  /**
   * Register a histogram metric
   */
  registerHistogram(histogram: Histogram): void {
    const key = this.metricKey(histogram.name, histogram.labels);
    this.histograms.set(key, histogram);
  }

  /**
   * Increment a counter
   */
  incrementCounter(name: string, labels: Record<string, string> = {}, amount: number = 1): void {
    const key = this.metricKey(name, labels);
    const counter = this.counters.get(key);
    if (counter) {
      counter.value += amount;
    } else {
      this.registerCounter({ name, help: '', value: amount, labels });
    }
  }

  /**
   * Set a gauge value
   */
  setGauge(name: string, value: number, labels: Record<string, string> = {}): void {
    const key = this.metricKey(name, labels);
    const gauge = this.gauges.get(key);
    if (gauge) {
      gauge.value = value;
    } else {
      this.registerGauge({ name, help: '', value, labels });
    }
  }

  /**
   * Observe a value in a histogram
   */
  observeHistogram(name: string, value: number, labels: Record<string, string> = {}): void {
    const key = this.metricKey(name, labels);
    const histogram = this.histograms.get(key);
    if (histogram) {
      histogram.observations.push(value);
      histogram.sum += value;
      histogram.count++;
    }
  }

  /**
   * Get a counter value
   */
  getCounter(name: string, labels: Record<string, string> = {}): number {
    const key = this.metricKey(name, labels);
    return this.counters.get(key)?.value || 0;
  }

  /**
   * Get a gauge value
   */
  getGauge(name: string, labels: Record<string, string> = {}): number {
    const key = this.metricKey(name, labels);
    return this.gauges.get(key)?.value || 0;
  }

  /**
   * Get histogram statistics
   */
  getHistogramStats(name: string, labels: Record<string, string> = {}): {
    count: number;
    sum: number;
    avg: number;
    p50: number;
    p95: number;
    p99: number;
  } {
    const key = this.metricKey(name, labels);
    const histogram = this.histograms.get(key);
    if (!histogram || histogram.observations.length === 0) {
      return { count: 0, sum: 0, avg: 0, p50: 0, p95: 0, p99: 0 };
    }

    const sorted = [...histogram.observations].sort((a, b) => a - b);
    const count = sorted.length;
    const sum = histogram.sum;
    const avg = sum / count;

    const p50 = sorted[Math.floor(count * 0.5)];
    const p95 = sorted[Math.floor(count * 0.95)];
    const p99 = sorted[Math.floor(count * 0.99)];

    return { count, sum, avg, p50, p95, p99 };
  }

  /**
   * Export metrics in Prometheus text format
   */
  exportPrometheus(): string {
    const lines: string[] = [];

    // Export counters
    for (const [key, counter] of this.counters.entries()) {
      if (counter.help) {
        lines.push(`# HELP ${counter.name} ${counter.help}`);
        lines.push(`# TYPE ${counter.name} counter`);
      }
      const labelStr = this.formatLabels(counter.labels);
      lines.push(`${counter.name}${labelStr} ${counter.value}`);
    }

    // Export gauges
    for (const [key, gauge] of this.gauges.entries()) {
      if (gauge.help) {
        lines.push(`# HELP ${gauge.name} ${gauge.help}`);
        lines.push(`# TYPE ${gauge.name} gauge`);
      }
      const labelStr = this.formatLabels(gauge.labels);
      lines.push(`${gauge.name}${labelStr} ${gauge.value}`);
    }

    // Export histograms
    for (const [key, histogram] of this.histograms.entries()) {
      if (histogram.help) {
        lines.push(`# HELP ${histogram.name} ${histogram.help}`);
        lines.push(`# TYPE ${histogram.name} histogram`);
      }

      const labelStr = this.formatLabels(histogram.labels);
      const stats = this.getHistogramStats(histogram.name, histogram.labels);

      // Buckets
      for (const bucket of histogram.buckets) {
        const bucketCount = histogram.observations.filter((v) => v <= bucket).length;
        lines.push(`${histogram.name}_bucket${this.formatLabels({ ...histogram.labels, le: bucket.toString() })} ${bucketCount}`);
      }

      // +Inf bucket
      lines.push(`${histogram.name}_bucket${this.formatLabels({ ...histogram.labels, le: '+Inf' })} ${histogram.count}`);

      // Sum and count
      lines.push(`${histogram.name}_sum${labelStr} ${histogram.sum}`);
      lines.push(`${histogram.name}_count${labelStr} ${histogram.count}`);
    }

    return lines.join('\n') + '\n';
  }

  /**
   * Export metrics as JSON
   */
  exportJSON(): {
    counters: Record<string, number>;
    gauges: Record<string, number>;
    histograms: Record<string, { count: number; sum: number; avg: number; p50: number; p95: number; p99: number }>;
  } {
    const counters: Record<string, number> = {};
    const gauges: Record<string, number> = {};
    const histograms: Record<string, { count: number; sum: number; avg: number; p50: number; p95: number; p99: number }> = {};

    for (const [key, counter] of this.counters.entries()) {
      counters[key] = counter.value;
    }

    for (const [key, gauge] of this.gauges.entries()) {
      gauges[key] = gauge.value;
    }

    for (const [key, histogram] of this.histograms.entries()) {
      histograms[key] = this.getHistogramStats(histogram.name, histogram.labels);
    }

    return { counters, gauges, histograms };
  }

  /**
   * Reset all metrics
   */
  reset(): void {
    this.counters.clear();
    this.gauges.clear();
    this.histograms.clear();
    this.initializeMetrics();
  }

  /**
   * Generate metric key from name and labels
   */
  private metricKey(name: string, labels: Record<string, string>): string {
    const labelPairs = Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}="${v}"`)
      .join(',');
    return labelPairs ? `${name}{${labelPairs}}` : name;
  }

  /**
   * Format labels for Prometheus output
   */
  private formatLabels(labels: Record<string, string>): string {
    const pairs = Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}="${v}"`);
    return pairs.length > 0 ? `{${pairs.join(',')}}` : '';
  }
}

/**
 * Global metrics instance
 */
export const ontologyMetrics = new OntologyMetrics();

/**
 * Timer utility for measuring duration
 */
export class MetricsTimer {
  private startTime: number;

  constructor(
    private metricsInstance: OntologyMetrics,
    private histogramName: string,
    private labels: Record<string, string> = {}
  ) {
    this.startTime = Date.now();
  }

  /**
   * Stop timer and record duration
   */
  stop(): number {
    const duration = (Date.now() - this.startTime) / 1000; // Convert to seconds
    this.metricsInstance.observeHistogram(this.histogramName, duration, this.labels);
    return duration;
  }
}

/**
 * Create a timer for measuring operation duration
 */
export function startTimer(histogramName: string, labels: Record<string, string> = {}): MetricsTimer {
  return new MetricsTimer(ontologyMetrics, histogramName, labels);
}
