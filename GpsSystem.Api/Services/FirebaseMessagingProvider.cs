using FirebaseAdmin;
using FirebaseAdmin.Messaging;
using Google.Apis.Auth.OAuth2;

namespace GpsSystem.Api.Services;

public sealed class FirebaseMessagingProvider
{
    public FirebaseMessaging? Messaging { get; }

    public FirebaseMessagingProvider(IConfiguration configuration, ILogger<FirebaseMessagingProvider> logger)
    {
        var serviceAccountJson = Environment.GetEnvironmentVariable("FIREBASE_SERVICE_ACCOUNT")
            ?? configuration["Firebase:ServiceAccountJson"];
        var serviceAccountPath = Environment.GetEnvironmentVariable("GOOGLE_APPLICATION_CREDENTIALS")
            ?? configuration["Firebase:ServiceAccountPath"];

        GoogleCredential? credential = null;
        if (!string.IsNullOrWhiteSpace(serviceAccountJson))
        {
            credential = CredentialFactory.FromJson<ServiceAccountCredential>(serviceAccountJson).ToGoogleCredential();
        }
        else if (!string.IsNullOrWhiteSpace(serviceAccountPath))
        {
            if (!File.Exists(serviceAccountPath))
            {
                throw new FileNotFoundException("No se encontró el archivo de credenciales de Firebase configurado.", serviceAccountPath);
            }

            credential = CredentialFactory.FromFile<ServiceAccountCredential>(serviceAccountPath).ToGoogleCredential();
        }

        if (credential is null)
        {
            logger.LogWarning("Firebase Cloud Messaging está desactivado: configura FIREBASE_SERVICE_ACCOUNT o GOOGLE_APPLICATION_CREDENTIALS.");
            return;
        }

        var projectId = configuration["Firebase:ProjectId"];
        var firebaseApp = FirebaseApp.Create(new AppOptions
        {
            Credential = credential,
            ProjectId = string.IsNullOrWhiteSpace(projectId) ? null : projectId
        }, "GpsSystemApi");
        Messaging = FirebaseMessaging.GetMessaging(firebaseApp);
        logger.LogInformation("Firebase Cloud Messaging quedó inicializado.");
    }
}
