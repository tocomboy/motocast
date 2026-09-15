import type { Metadata } from "next";
import Link from "next/link";

import { currentVersion, releaseNotes } from "@/lib/releases";

import styles from "./updates.module.css";

export const metadata: Metadata = {
  title: "업데이트 소식 | MOTOCAST",
};

export default function UpdatesPage() {
  return (
    <main className={styles.page}>
      <nav className={styles.navigation} aria-label="업데이트 페이지 탐색">
        <Link className={styles.brand} href="/" aria-label="MOTOCAST 홈">
          <span className={styles.brandMark}>M</span>
          <span>MOTOCAST</span>
        </Link>
        <Link className={styles.backLink} href="/">플래너로 돌아가기</Link>
      </nav>

      <header className={styles.header}>
        <h1>업데이트 소식</h1>
        <p>라이딩 준비가 어떻게 달라졌는지, 중요한 소식만 모았어요.</p>
      </header>

      <section className={styles.timeline} aria-label="버전별 업데이트">
        {releaseNotes.map((release) => {
          const isCurrent = release.version === currentVersion;
          return (
            <article className={styles.release} key={release.version}>
              <div className={styles.meta}>
                <span className={styles.version}>v{release.version}</span>
                <time dateTime={release.date}>{release.date}</time>
                {isCurrent ? <span className={styles.current}>현재 버전</span> : null}
              </div>
              <h2>{release.title}</h2>
              <p className={styles.summary}>{release.summary}</p>
              <ul>
                {release.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}
              </ul>
            </article>
          );
        })}
      </section>
    </main>
  );
}
