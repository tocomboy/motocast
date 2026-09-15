import Link from "next/link";

import { currentVersion } from "@/lib/releases";

import styles from "./release-footer.module.css";

export function ReleaseFooter() {
  return (
    <footer className={styles.footer}>
      <Link href="/updates">업데이트 소식 · v{currentVersion}</Link>
    </footer>
  );
}
