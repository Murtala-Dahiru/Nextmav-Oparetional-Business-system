"use client";

import { useId, useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  Check,
  ChevronRight,
  FileText,
  Layers,
  Link2,
  CalendarDays,
  MessageSquare,
} from "lucide-react";
import {
  TOUR,
  TOUR_GROUPS,
  type TourKey,
  type TourModule,
} from "./product-tour-data";

function RecordTable({ module }: { module: TourModule }) {
  return (
    <div className="nm-tour-table">
      <table>
        <caption className="nm-sr-only">
          Illustrative {module.label} records
        </caption>
        <thead>
          <tr>
            {module.columns.map((label) => (
              <th scope="col" key={label}>
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {module.rows.map(([name, context, status]) => (
            <tr key={name}>
              <td>
                {name}
                <span className="nm-tour-record-context">
                  {module.columns[1]}: {context}
                </span>
              </td>
              <td>{context}</td>
              <td>
                <span
                  className={`nm-tour-status ${["Done", "Paid", "Resolved", "Active", "In stock"].includes(status) ? "is-positive" : ""}`}
                >
                  {status}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ModuleVisual({ module }: { module: TourModule }) {
  if (module.kind === "overview")
    return (
      <div className="nm-tour-overview">
        <div className="nm-tour-overview-intro">
          <span>EXECUTIVE OVERVIEW</span>
          <h3>Your business, in focus.</h3>
          <p>Financial performance. Delivery health. What needs attention.</p>
        </div>
        <div className="nm-tour-attention">
          <span className="nm-tour-label">Attention across the workspace</span>
          {module.rows.map(([title, source, action], i) => (
            <div key={title}>
              <span className="nm-tour-index">0{i + 1}</span>
              <div>
                <strong>{title}</strong>
                <small>{source}</small>
              </div>
              <span>
                {action}
                <ChevronRight size={13} />
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  if (module.kind === "board")
    return (
      <div className="nm-tour-board">
        {module.columns.map((stage, i) => (
          <section key={stage}>
            <h3>
              <span /> {stage}
            </h3>
            <article>
              <span className="nm-tour-label">Example opportunity</span>
              <h4>{module.rows[i][0]}</h4>
              <p>{module.rows[i][1]}</p>
              <div>
                <span>Customer relationship</span>
                <Link2 size={13} />
              </div>
            </article>
          </section>
        ))}
      </div>
    );
  if (module.kind === "conversation")
    return (
      <div className="nm-tour-conversation">
        <h3>
          <MessageSquare size={17} /> project-delivery
        </h3>
        {module.rows.map(([person, message], i) => (
          <div key={person}>
            <span className="nm-tour-avatar">
              {String.fromCharCode(65 + i)}
            </span>
            <p>
              <strong>
                {person}
                <small>Example message</small>
              </strong>
              {message}
            </p>
          </div>
        ))}
        <div className="nm-tour-attached">
          <FileText size={16} /> Handover notes <span>Shared file</span>
        </div>
      </div>
    );
  if (module.kind === "library")
    return (
      <div className="nm-tour-library">
        <div className="nm-tour-library-head">
          <span className="nm-tour-label">WORKSPACE / LIBRARY</span>
          <h3>Knowledge that stays with the team.</h3>
        </div>
        {module.rows.map(([title, kind, scope]) => (
          <div className="nm-tour-file" key={title}>
            <FileText size={20} />
            <div>
              <strong>{title}</strong>
              <small>{kind}</small>
            </div>
            <span>{scope}</span>
          </div>
        ))}
      </div>
    );
  if (module.kind === "calendar")
    return (
      <div className="nm-tour-calendar">
        <div>
          <CalendarDays size={24} />
          <span className="nm-tour-label">SAMPLE SCHEDULE</span>
          <h3>A day with a clear plan.</h3>
          <p>Events, times and locations together.</p>
        </div>
        <ol>
          {module.rows.map(([event, time, location]) => (
            <li key={event}>
              <time>{time}</time>
              <div>
                <strong>{event}</strong>
                <span>{location}</span>
              </div>
            </li>
          ))}
        </ol>
      </div>
    );
  if (module.kind === "portal")
    return (
      <div className="nm-tour-portal">
        <div className="nm-tour-library-head">
          <span className="nm-tour-label">
            CLIENT VIEW / EXAMPLE ENGAGEMENT
          </span>
          <h3>Your project, at a glance.</h3>
          <p>Milestones and deliverables, in one place.</p>
        </div>
        <ol>
          {module.rows.map(([name, , status], i) => (
            <li key={name}>
              <span>{i === 0 ? <Check size={14} /> : `0${i + 1}`}</span>
              <strong>{name}</strong>
              <small>{status}</small>
            </li>
          ))}
        </ol>
        <div className="nm-tour-portal-links">
          <span>Deliverables</span>
          <span>Invoices</span>
          <span>Support</span>
        </div>
      </div>
    );
  return <RecordTable module={module} />;
}

/** Public, synthetic representations. Never imports business components or calls APIs. */
export function ProductPreview({
  initialView = "dashboard",
}: {
  initialView?: TourKey;
}) {
  const [view, setView] = useState<TourKey>(initialView);
  const id = useId();
  const current = TOUR[view];
  const group = TOUR_GROUPS.find((item) => item.keys.includes(view))!;
  return (
    <figure className="nm-product-demo nm-product-gallery">
      <div className="nm-tour-chrome">
        <span>
          <Layers size={18} /> NextMav <span>/ Product explorer</span>
        </span>
        <span>{Object.keys(TOUR).length} connected modules</span>
      </div>
      <div className="nm-tour-groups" aria-label="Product categories">
        {TOUR_GROUPS.map((item) => (
          <button
            type="button"
            key={item.label}
            aria-pressed={item === group}
            aria-controls={`${id}-modules`}
            onClick={() => setView(item.keys[0])}
          >
            {item.label}
            <span>{item.keys.length}</span>
          </button>
        ))}
      </div>
      <div className="nm-tour-mobile-select">
        <label htmlFor={`${id}-select`}>Explore a module</label>
        <select
          id={`${id}-select`}
          value={view}
          onChange={(event) => setView(event.target.value as TourKey)}
        >
          {TOUR_GROUPS.map((item) => (
            <optgroup key={item.label} label={item.label}>
              {item.keys.map((key) => (
                <option value={key} key={key}>
                  {TOUR[key].label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
      <div className="nm-tour-layout">
        <aside
          className="nm-tour-nav"
          aria-label="Product modules"
          id={`${id}-modules`}
        >
          <span className="nm-tour-label">{group.label}</span>
          {group.keys.map((key) => {
            const item = TOUR[key];
            return (
              <button
                key={key}
                type="button"
                onClick={() => setView(key)}
                aria-pressed={key === view}
                aria-controls={`${id}-panel`}
              >
                <item.icon size={18} />
                <span>{item.label}</span>
                <ChevronRight size={14} />
              </button>
            );
          })}
          <div className="nm-tour-nav-note">
            <Link2 size={18} />
            <p>
              Different teams.
              <br />
              One shared foundation.
            </p>
          </div>
        </aside>
        <section
          className="nm-tour-panel"
          id={`${id}-panel`}
          aria-labelledby={`${id}-title`}
        >
          <div className="nm-tour-panel-meta">
            <span>
              <current.icon size={15} />
              {current.label}
            </span>
            <span>ILLUSTRATIVE PREVIEW</span>
          </div>
          <div
            className="nm-tour-heading"
            aria-live="polite"
            aria-atomic="true"
          >
            <h2 id={`${id}-title`}>{current.title}</h2>
            <p>{current.description}</p>
          </div>
          <div className="nm-tour-visual" key={view}>
            <ModuleVisual module={current} />
          </div>
          <div className="nm-tour-benefits">
            {current.features.map((feature) => (
              <span key={feature}>
                <Check size={13} />
                {feature}
              </span>
            ))}
          </div>
          <div className="nm-tour-detail">
            <p>{current.context}</p>
            <Link href={`/features#${current.anchor}`}>
              Explore capability <ArrowUpRight size={15} />
            </Link>
          </div>
        </section>
      </div>
      <figcaption>
        Illustrative product tour · Synthetic example records based on
        implemented capabilities. This is not a live workspace or an application
        screenshot.
      </figcaption>
    </figure>
  );
}
