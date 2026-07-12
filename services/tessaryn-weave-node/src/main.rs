use tessaryn_weave_node::{router, WeaveConfig, WeaveNode};

#[tokio::main]
async fn main() {
    if let Err(error) = run().await {
        eprintln!("tessaryn-weave-node: {error}");
        std::process::exit(1);
    }
}

async fn run() -> Result<(), Box<dyn std::error::Error>> {
    let config = WeaveConfig::from_env()?;
    let listen = config.listen;
    let node = WeaveNode::open(config)?;
    let app = router(node)?;
    let listener = tokio::net::TcpListener::bind(listen).await?;
    println!("TESSARYN Object Weave listening on {listen}");
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    Ok(())
}

async fn shutdown_signal() {
    let control_c = async {
        tokio::signal::ctrl_c()
            .await
            .expect("failed to install Ctrl+C handler");
    };
    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("failed to install SIGTERM handler")
            .recv()
            .await;
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();
    tokio::select! {
        () = control_c => {},
        () = terminate => {},
    }
}
