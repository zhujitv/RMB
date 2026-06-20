import styles from "./WorkspaceShell.module.css";

export default function NotFound() {
  return (
    <main className={styles.notFoundPage}>
      <section className={styles.notFoundPanel}>
        <span>404</span>
        <h1>页面不存在</h1>
        <p>请返回工作台继续处理业务。</p>
      </section>
    </main>
  );
}
