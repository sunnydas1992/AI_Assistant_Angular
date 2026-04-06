import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-advanced-settings-help',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <div class="help-page">
      <header class="page-header help-header">
        <div>
          <p class="eyebrow">Configuration</p>
          <h1 class="page-title">Advanced Settings Explained</h1>
          <p class="page-subtitle">
            Plain-language descriptions of the options under <strong>Advanced Settings</strong> on the Configuration page.
          </p>
        </div>
        <a routerLink="/config" class="back-link">Back to Configuration</a>
      </header>

      <nav class="toc card" aria-label="On this page">
        <span class="toc-label">On This Page</span>
        <ul>
          <li><a routerLink="/help/advanced-settings" fragment="vector-store">Vector Store Directory</a></li>
          <li><a routerLink="/help/advanced-settings" fragment="chunk-size">Chunk Size &amp; Overlap</a></li>
          <li><a routerLink="/help/advanced-settings" fragment="top-k">Top-K (Retrieval)</a></li>
          <li><a routerLink="/help/advanced-settings" fragment="llm-model">LLM Model</a></li>
          <li><a routerLink="/help/advanced-settings" fragment="temperature">Temperature</a></li>
          <li><a routerLink="/help/advanced-settings" fragment="inference-profile">Inference Profile ID</a></li>
        </ul>
      </nav>

      <article class="card help-body">
        <section id="vector-store" class="help-section" tabindex="-1">
          <h2>Vector Store Directory</h2>
          <p>
            This is the <strong>folder on the server</strong> where the app stores your knowledge base as a vector database
            (embeddings). Documents you add in Knowledge Base are split into pieces, turned into vectors, and saved here so
            the assistant can find relevant text when answering or generating tests.
          </p>
          <p>
            The default path is usually fine. Change it only if you need a specific disk location or isolation. After
            changing it, you typically need to <strong>Initialize</strong> again so a new store is used.
          </p>
        </section>

        <section id="chunk-size" class="help-section" tabindex="-1">
          <h2>Chunk Size and Chunk Overlap</h2>
          <p>
            <strong>Chunk size</strong> is roughly how much text (in characters) goes into each <em>segment</em> when your
            docs are indexed. Larger chunks keep more context in one piece but create fewer pieces; smaller chunks are more
            granular but may split ideas across boundaries.
          </p>
          <p>
            <strong>Chunk overlap</strong> repeats a bit of text at the start and end of neighboring chunks so sentences
            or bullet lists are not cut awkwardly in the middle. A modest overlap (for example 10–20% of chunk size) often
            improves retrieval quality.
          </p>
        </section>

        <section id="top-k" class="help-section" tabindex="-1">
          <h2>Top-K (Retrieval)</h2>
          <p>
            When the app uses the knowledge base, it searches for the <strong>K most similar</strong> chunks to your
            question or ticket. That number is Top-K.
          </p>
          <p>
            A <strong>higher</strong> value sends more context to the model (broader coverage, but more noise and slightly
            higher cost). A <strong>lower</strong> value keeps only the closest matches (tighter focus, risk of missing a
            relevant paragraph). Typical values are small single digits (for example 4–8).
          </p>
        </section>

        <section id="llm-model" class="help-section" tabindex="-1">
          <h2>LLM Model</h2>
          <p>
            This is the <strong>AWS Bedrock</strong> language model used for chat, test generation, refinement, and related
            AI steps. The dropdown lists models available in your account and region.
          </p>
          <p>
            Choosing a <strong>different model</strong> triggers a full re-initialization so the backend reconnects with
            the new model. Wait until that finishes before using other features.
          </p>
        </section>

        <section id="temperature" class="help-section" tabindex="-1">
          <h2>Temperature</h2>
          <p>
            Temperature controls how <strong>random</strong> or <strong>creative</strong> the model’s outputs are. Values
            are usually between 0 and 1.
          </p>
          <p>
            <strong>Lower</strong> (closer to 0): more deterministic, repeatable wording—often better for consistent test
            steps. <strong>Higher</strong>: more variety and paraphrasing—can help brainstorming but may be less predictable.
          </p>
        </section>

        <section id="inference-profile" class="help-section" tabindex="-1">
          <h2>Inference Profile ID (Optional)</h2>
          <p>
            Some Bedrock models are exposed through an AWS <strong>inference profile</strong> instead of a simple on-demand
            model ID. If your organization uses those, you can paste the profile identifier here when the app or docs
            require it.
          </p>
          <p>
            Leave this blank if you are using a standard model from the dropdown and initialization works without it.
          </p>
        </section>

        <p class="help-footer">
          <a routerLink="/config" class="inline-link">Return to Configuration</a>
        </p>
      </article>
    </div>
  `,
  styles: [`
    .help-page { max-width: 42rem; margin: 0 auto; padding-bottom: var(--space-xl); }
    .help-header {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-start;
      justify-content: space-between;
      gap: var(--space-md);
      margin-bottom: var(--space-lg);
    }
    .eyebrow {
      margin: 0 0 var(--space-xs);
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--app-text-muted);
    }
    .page-header .page-title { margin-bottom: var(--space-xs); }
    .page-header .page-subtitle { margin: 0; font-size: 0.9rem; line-height: 1.45; }
    .back-link {
      flex-shrink: 0;
      align-self: center;
      font-size: 0.9rem;
      font-weight: 600;
      color: var(--hyland-blue);
      text-decoration: none;
    }
    .back-link:hover { text-decoration: underline; }
    .toc {
      margin-bottom: var(--space-lg);
      padding: var(--space-md) var(--space-lg);
    }
    .toc-label {
      display: block;
      font-size: 0.8rem;
      font-weight: 600;
      color: var(--app-text-muted);
      margin-bottom: var(--space-sm);
    }
    .toc ul {
      margin: 0;
      padding-left: 1.1rem;
      font-size: 0.9rem;
      line-height: 1.6;
    }
    .toc a {
      color: var(--hyland-blue);
      text-decoration: none;
    }
    .toc a:hover { text-decoration: underline; }
    .help-body {
      padding: var(--space-lg) var(--space-xl);
    }
    .help-section {
      scroll-margin-top: var(--space-lg);
      margin-bottom: var(--space-xl);
    }
    .help-section:last-of-type { margin-bottom: var(--space-md); }
    .help-section h2 {
      margin: 0 0 var(--space-sm);
      font-size: 1.05rem;
    }
    .help-section p {
      margin: 0 0 var(--space-md);
      font-size: 0.9rem;
      line-height: 1.55;
      color: var(--app-text, inherit);
    }
    .help-section p:last-child { margin-bottom: 0; }
    .help-footer { margin: var(--space-lg) 0 0; font-size: 0.9rem; }
    .inline-link {
      color: var(--hyland-blue);
      font-weight: 600;
      text-decoration: none;
    }
    .inline-link:hover { text-decoration: underline; }
  `],
})
export class AdvancedSettingsHelpComponent {}
