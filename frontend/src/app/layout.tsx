import type { Metadata } from "next";
import "@fontsource/dm-sans/400.css";
import "@fontsource/dm-sans/500.css";
import "@fontsource/dm-sans/600.css";
import "@fontsource/fraunces/400.css";
import "@fontsource/fraunces/400-italic.css";
import "./globals.css";
import { CollegeHeader } from "@/components/CollegeHeader";
import { SessionProvider } from "@/components/SessionProvider";
export const metadata: Metadata = { title: "CampusDine · National College of Engineering", description: "The National College of Engineering canteen: menu, orders and student accounts." };
const themeScript = `try{var t=localStorage.getItem('campusdine-theme');document.documentElement.dataset.theme=t==='dark'||(!t&&matchMedia('(prefers-color-scheme: dark)').matches)?'dark':'light'}catch(e){document.documentElement.dataset.theme=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}`;
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head><body><a className="skip-link" href="#main">Skip to content</a><SessionProvider><CollegeHeader />{children}</SessionProvider><footer className="site-footer"><span>National College of Engineering</span><span>CampusDine · Canteen & student accounts</span></footer></body></html>;
}
