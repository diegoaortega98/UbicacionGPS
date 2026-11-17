namespace GpsSystem.Api.Services;

public interface IEmailService
{
    Task EnviarCodigoRecuperacionAsync(
        string email,
        string codigo,
        CancellationToken cancellationToken);
}
