using FirebaseAdmin;
using FirebaseAdmin.Messaging;
using Google.Apis.Auth.OAuth2;

namespace GpsSystem.Api.Services;

public sealed class FirebaseMessagingProvider
{
    public FirebaseMessaging? Messaging { get; }

    public FirebaseMessagingProvider(
        IConfiguration configuration,
        IWebHostEnvironment environment,
        ILogger<FirebaseMessagingProvider> logger)
    {
        try
        {
            Messaging = Initialize(configuration, environment, logger);
        }
        catch (Exception exception)
        {
            logger.LogError(
                "Firebase no disponible; la aplicación continuará sin notificaciones. Error: {ErrorType}",
                exception.GetType().Name);
        }
    }

    private static FirebaseMessaging? Initialize(
        IConfiguration configuration,
        IWebHostEnvironment environment,
        ILogger<FirebaseMessagingProvider> logger)
    {
        var serviceAccountJson = Environment.GetEnvironmentVariable("FIREBASE_CREDENTIALS_JSON");
        if (string.IsNullOrWhiteSpace(serviceAccountJson))
        {
            serviceAccountJson = Environment.GetEnvironmentVariable("FIREBASE_SERVICE_ACCOUNT");
        }
        if (string.IsNullOrWhiteSpace(serviceAccountJson))
        {
            serviceAccountJson = configuration["Firebase:ServiceAccountJson"];
        }

        var serviceAccountPath = Environment.GetEnvironmentVariable("GOOGLE_APPLICATION_CREDENTIALS")
            ?? configuration["Firebase:ServiceAccountPath"];
        if (string.IsNullOrWhiteSpace(serviceAccountJson) && string.IsNullOrWhiteSpace(serviceAccountPath))
        {
            var defaultPath = Path.GetFullPath(
                Path.Combine(environment.ContentRootPath, "..", "firebase-adminsdk.json"));
            if (File.Exists(defaultPath))
            {
                serviceAccountPath = defaultPath;
            }
            else
            {
                var credentialFiles = Directory.GetFiles(
                    Path.GetDirectoryName(defaultPath)!,
                    "firebase-adminsdk*.json");
                if (credentialFiles.Length == 1)
                {
                    serviceAccountPath = credentialFiles[0];
                }
            }
        }

        GoogleCredential? credential = null;
        if (!string.IsNullOrWhiteSpace(serviceAccountJson))
        {
            credential = CredentialFactory.FromJson<ServiceAccountCredential>(serviceAccountJson).ToGoogleCredential();
        }
        else if (!string.IsNullOrWhiteSpace(serviceAccountPath))
        {
            if (!File.Exists(serviceAccountPath))
            {
                logger.LogWarning(
                    "Firebase Cloud Messaging está desactivado: no se encontró el archivo de credenciales configurado.");
                return null;
            }

            credential = CredentialFactory.FromFile<ServiceAccountCredential>(serviceAccountPath).ToGoogleCredential();
        }

        if (credential is null)
        {
            logger.LogWarning(
                "Firebase Cloud Messaging está desactivado: configura FIREBASE_CREDENTIALS_JSON o coloca firebase-adminsdk.json en la raíz del repositorio.");
            return null;
        }

        var projectId = configuration["Firebase:ProjectId"];
        if (string.IsNullOrWhiteSpace(projectId))
        {
            projectId = configuration["Firebase:Web:ProjectId"];
        }
        FirebaseApp.Create(new AppOptions
        {
            Credential = credential,
            ProjectId = string.IsNullOrWhiteSpace(projectId) ? null : projectId
        });
        var messaging = FirebaseMessaging.DefaultInstance;
        logger.LogInformation("Firebase Cloud Messaging quedó inicializado.");
        return messaging;
    }
}
