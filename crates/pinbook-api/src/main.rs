use pinbook_api::ServerConfig;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    pinbook_api::init_tracing();
    pinbook_api::run(ServerConfig::default()).await
}
