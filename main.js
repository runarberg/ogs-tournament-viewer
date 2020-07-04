const API_ROOT = "https://online-go.com/api/v1";

async function findPlayer(username) {
  if (!username) {
    return null;
  }

  const playersResponse = await fetch(
    `${API_ROOT}/players?username=${username}`
  );
  const playersResult = await playersResponse.json();

  return playersResult.results.find((player) => player.username === username);
}

async function findTournament(id) {
  const response = await fetch(`${API_ROOT}/tournaments/59567/rounds`);
  return response.json();
}

async function getRounds() {
  const searchParams = new URLSearchParams(window.location.search);
  const [player, tournament] = await Promise.all([
    findPlayer(searchParams.get("player")),
    findTournament(59567),
  ]);

  if (!player) {
    return [];
  }

  return Promise.all(
    tournament.map(async (round) => {
      const opponents = round.matches
        .filter(
          ({ white, black }) => white === player.id || black === player.id
        )
        .map(({ white, black }) => (white === player.id ? black : white));

      const players = await Promise.all(
        [player.id, ...opponents].map((id) =>
          fetch(`${API_ROOT}/players/${id}`).then((response) => response.json())
        )
      );

      const games = await Promise.all(
        round.matches
          .filter(({ white }) => players.some(({ id }) => id === white))
          .map(({ gameid }) =>
            fetch(`${API_ROOT}/games/${gameid}`).then((response) =>
              response.json()
            )
          )
      );

      return {
        round: round.round_number,
        players: players.map((player) => ({
          player,
          games: games.filter(
            ({ players }) =>
              players.white.id === player.id || players.black.id === player.id
          ),
        })),
      };
    })
  );
}

function getResult(gamedata) {
  if (gamedata.phase !== "finished") {
    return `(${gamedata.moves.length})`;
  }

  const winner = gamedata.winner === gamedata.players.black.id ? "B" : "W";

  return `${winner} + ${gamedata.outcome}`;
}

function renderGames(player) {
  const table = document.createElement("table");

  {
    const thead = document.createElement("thead");
    const tr = document.createElement("tr");

    {
      const th = document.createElement("th");

      th.textContent = "Color";
      tr.appendChild(th);
    }

    {
      const th = document.createElement("th");

      th.textContent = "Opponent";
      tr.appendChild(th);
    }

    {
      const th = document.createElement("th");

      th.textContent = "Result (Move)";
      tr.appendChild(th);
    }

    thead.appendChild(tr);
    table.appendChild(thead);
  }

  {
    const tbody = document.createElement("tbody");

    for (const game of player.games) {
      const isBlack = game.players.black.id === player.player.id;
      const opponent = isBlack ? game.players.white : game.players.black;
      const tr = document.createElement("tr");

      {
        const td = document.createElement("td");

        td.textContent = isBlack ? "Black" : "White";
        tr.appendChild(td);
      }

      {
        const td = document.createElement("td");
        const anchor = document.createElement("a");

        anchor.href = `https://online-go.com/player/${opponent.id}`;
        anchor.textContent = opponent.username;
        td.appendChild(anchor);
        tr.appendChild(td);
      }

      {
        const { gamedata } = game;
        const td = document.createElement("td");
        const anchor = document.createElement("a");

        anchor.href = `https://online-go.com/game/${game.id}`;
        anchor.textContent = getResult(gamedata);
        td.appendChild(anchor);
        tr.appendChild(td);
      }

      tbody.appendChild(tr);
    }

    table.appendChild(tbody);
  }

  return table;
}

function renderPlayer(player) {
  const article = document.createElement("article");

  {
    const heading = document.createElement("h3");
    const anchor = document.createElement("a");

    anchor.href = `https://online-go.com/player/${player.player.id}`;
    anchor.textContent = player.player.username;
    heading.appendChild(anchor);
    article.appendChild(heading);
  }

  article.appendChild(renderGames(player));

  return article;
}

function renderRound(round) {
  const section = document.createElement("section");

  {
    const heading = document.createElement("h2");

    heading.textContent = `Round ${round.round}`;
    section.appendChild(heading);
  }

  {
    const ul = document.createElement("ul");

    for (const player of round.players) {
      const li = document.createElement("li");

      li.appendChild(renderPlayer(player));
      ul.appendChild(li);
    }

    section.appendChild(ul);
  }

  return section;
}

async function main() {
  const rounds = await getRounds();

  for (const round of rounds) {
    const el = renderRound(round);

    document.body.appendChild(el);
  }
}

document.addEventListener("DOMContentLoaded", main);
