import Link from "next/link";
import { ThemeToggle } from "./ThemeToggle";
export function CollegeHeader() {
  return <header className="college-header">
    <Link className="brand" href="/sign-in" aria-label="CampusDine sign in"><span className="brand-mark" aria-hidden="true">cd.</span><span><strong>CampusDine</strong><small>National College of Engineering</small></span></Link>
    <div className="flex items-center gap-6"><span className="college-affiliation">TU / IOE · Nepal</span><ThemeToggle /></div>
  </header>;
}
