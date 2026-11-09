# Optional: build your own local Bot API server (instead of the
# aiogram/telegram-bot-api image). Requires: git, cmake, g++ (C++17),
# make, gperf, pkg-config, libssl-dev, zlib1g-dev.
FROM ubuntu:24.04 AS build
RUN apt-get update && apt-get install -y --no-install-recommends \
    git cmake g++ make gperf pkg-config libssl-dev zlib1g-dev ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
RUN git clone --recursive https://github.com/tdlib/telegram-bot-api.git
RUN mkdir -p telegram-bot-api/build && cd telegram-bot-api/build \
    && cmake -DCMAKE_BUILD_TYPE=Release .. \
    && cmake --build . --target telegram-bot-api -j"$(nproc)"

FROM ubuntu:24.04
RUN apt-get update && apt-get install -y --no-install-recommends \
    libssl3 zlib1g ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=build /src/telegram-bot-api/build/telegram-bot-api /usr/local/bin/telegram-bot-api
# usage:
#   TELEGRAM_API_ID=<id> TELEGRAM_API_HASH=<hash> \
#   telegram-bot-api --local --http-port=8081
CMD ["telegram-bot-api", "--local", "--http-port=8081"]
