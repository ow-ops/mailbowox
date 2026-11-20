mod common;

use mailbowox_core::{CoreError, verify_incoming, verify_outgoing};

#[tokio::test]
async fn working_credentials_log_in_to_both_servers() {
    let Some(()) = common::local_server() else {
        return;
    };
    verify_incoming(common::account("alice"))
        .await
        .expect("incoming");
    verify_outgoing(common::account("alice"))
        .await
        .expect("outgoing");
}

#[tokio::test]
async fn a_wrong_password_is_reported_as_auth_by_each_server() {
    let Some(()) = common::local_server() else {
        return;
    };
    let mut config = common::account("alice");
    config.credentials.password = "wrong".into();

    let incoming = verify_incoming(config.clone()).await.expect_err("rejected");
    assert!(matches!(incoming, CoreError::Auth { .. }), "{incoming:?}");
    let outgoing = verify_outgoing(config).await.expect_err("rejected");
    assert!(matches!(outgoing, CoreError::Auth { .. }), "{outgoing:?}");
}
