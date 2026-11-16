import Link from "next/link";
import { ArrowUpRight, ArrowRight } from "lucide-react";
import { Logo } from "./ui";

const GROUPS = [
  {
    title: "Platform",
    links: [
      ["Product overview", "/features"],
      ["CRM & sales", "/features#crm"],
      ["Projects & delivery", "/features#projects"],
      ["People & performance", "/features#performance"],
      ["Pricing", "/pricing"],
    ],
  },
  {
    title: "Solutions",
    links: [
      ["Creative agencies", "/solutions/agencies"],
      ["Consulting", "/solutions/consulting"],
      ["IT services", "/solutions/technology"],
      ["Construction administration", "/solutions/construction"],
      ["Other businesses", "/solutions/other-businesses"],
    ],
  },
  {
    title: "Resources",
    links: [
      ["Documentation", "/docs"],
      ["Help center", "/help"],
      ["Blog", "/blog"],
      ["Service status", "/status"],
    ],
  },
  {
    title: "Company",
    links: [
      ["About NextMav", "/about"],
      ["Contact", "/contact"],
      ["Architecture", "/features#architecture"],
      ["Security & access", "/features#identity"],
    ],
  },
];

export function PublicFooter() {
  return (
    <footer className="nm-footer nm-footer-premium">
      <div className="nm-container">
        <div className="nm-footer-opening">
          <div>
            <Link href="/" aria-label="NextMav — home">
              <Logo size={34} />
            </Link>
            <p>
              One business.
              <br />
              <span>A more connected way to work.</span>
            </p>
          </div>
          <div>
            <p>
              Bring your customers, people and operations into one shared
              workspace.
            </p>
            <Link href="/signup" className="nm-footer-start">
              Get started <ArrowUpRight size={19} />
            </Link>
            <Link href="/features" className="nm-footer-explore">
              Explore the platform <ArrowRight size={14} />
            </Link>
          </div>
        </div>
        <nav className="nm-footer-directory" aria-label="Footer">
          {GROUPS.map((group) => (
            <div key={group.title}>
              <h2>{group.title}</h2>
              <ul>
                {group.links.map(([label, href]) => (
                  <li key={href}>
                    <Link href={href}>{label}</Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <div className="nm-footer-bottom">
          <span>
            © {new Date().getFullYear()} NextMav. All rights reserved.
          </span>
          <nav aria-label="Legal">
            <Link href="/privacy">Privacy policy</Link>
            <Link href="/terms">Terms of service</Link>
            <Link href="/cookies">Cookies</Link>
          </nav>
          <span className="nm-footer-signature">
            The Business Operating System
          </span>
        </div>
      </div>
    </footer>
  );
}
