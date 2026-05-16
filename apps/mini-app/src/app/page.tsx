export default function HomePage() {
  return (
    <main className="page">
      <div className="shell">
        <section className="hero">
          <span className="eyebrow">Mini App · подготовка к следующему этапу</span>
          <h1 className="title">Твой Бокс</h1>
          <p className="lead">
            Основа web-интерфейса уже подключена в проект и теперь корректно собирается. На текущем этапе
            основной фокус остается на Telegram-боте и сквозной проверке MVP перед деплоем.
          </p>
          <div className="badge-row">
            <span className="badge">Next.js App Router</span>
            <span className="badge">Готово к дальнейшему развитию</span>
            <span className="badge">Единая экосистема с API и ботом</span>
          </div>
        </section>

        <section className="grid">
          <article className="card">
            <div className="metric">
              <strong>15</strong>
              <span>этап проверки</span>
            </div>
            <h2>Что проверяем сейчас</h2>
            <ul className="status-list">
              <li>полную цепочку клиента от выбора слота до заявки;</li>
              <li>полную цепочку тренера: заявки, слоты, настройки;</li>
              <li>согласованность поведения с ТЗ перед возвратом к деплою.</li>
            </ul>
          </article>

          <article className="card">
            <h3>Текущая роль mini app</h3>
            <p>
              Этот экран пока выполняет роль аккуратной заглушки без мертвых build-ошибок. Он показывает,
              что web-часть проекта уже встроена в монорепозиторий и готова к расширению, когда мы
              вернемся к полноценному клиентскому кабинету.
            </p>
          </article>

          <article className="card">
            <h3>Что будет дальше</h3>
            <ul className="feature-list">
              <li>личный кабинет клиента внутри Telegram Mini App;</li>
              <li>просмотр и перенос тренировок в web-интерфейсе;</li>
              <li>единые данные с backend и ботом без дублирования логики.</li>
            </ul>
          </article>
        </section>
      </div>
    </main>
  );
}
