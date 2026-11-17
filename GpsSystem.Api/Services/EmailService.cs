using System.Net;
using System.Text.Encodings.Web;
using SendGrid;
using SendGrid.Helpers.Mail;

namespace GpsSystem.Api.Services;

public sealed class EmailService(
    IConfiguration configuration,
    IWebHostEnvironment environment,
    ILogger<EmailService> logger) : IEmailService
{
    public async Task EnviarCodigoRecuperacionAsync(
        string email,
        string codigo,
        CancellationToken cancellationToken)
    {
        var apiKey = configuration["Email:SendGridApiKey"];
        if (string.IsNullOrWhiteSpace(apiKey))
        {
            apiKey = configuration["SENDGRID_API_KEY"];
        }

        if (string.IsNullOrWhiteSpace(apiKey))
        {
            if (!environment.IsDevelopment())
            {
                throw new HttpRequestException(
                    "SendGrid no está configurado.",
                    null,
                    HttpStatusCode.ServiceUnavailable);
            }

            Console.WriteLine($"Código de restablecimiento para {email}: {codigo}");
            return;
        }

        var fromEmail = configuration["Email:FromEmail"];
        if (string.IsNullOrWhiteSpace(fromEmail))
        {
            throw new InvalidOperationException("Configura Email:FromEmail para enviar correos.");
        }

        var codigoHtml = HtmlEncoder.Default.Encode(codigo);
        var textoPlano = $"Tu código para recuperar la contraseña de UbicacionGPS es {codigo}. Vence en 15 minutos.";
        var html = $"""
            <!doctype html>
            <html lang="es">
            <body style="margin:0;padding:32px;background:#F4F6F8;font-family:Arial,Helvetica,sans-serif;color:#233142">
              <table role="presentation" style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden">
                <tr><td style="padding:24px;background:#123B63;color:#fff;font-size:22px;font-weight:bold">UbicacionGPS</td></tr>
                <tr><td style="padding:28px 24px">
                  <h1 style="margin:0 0 16px;color:#123B63;font-size:22px">Recupera tu contraseña</h1>
                  <p style="margin:0 0 20px;line-height:1.6">Usa este código para restablecer tu contraseña. El código vence en 15 minutos.</p>
                  <div style="padding:16px;border-radius:8px;background:#F4F6F8;color:#123B63;text-align:center;font-size:32px;font-weight:bold;letter-spacing:8px">{codigoHtml}</div>
                  <p style="margin:20px 0 0;color:#536477;line-height:1.6">Si no solicitaste este cambio, puedes ignorar este correo.</p>
                </td></tr>
              </table>
            </body>
            </html>
            """;

        var message = new SendGridMessage
        {
            From = new EmailAddress(fromEmail, "UbicacionGPS"),
            Subject = "Código para recuperar tu contraseña",
            PlainTextContent = textoPlano,
            HtmlContent = html
        };
        message.AddTo(new EmailAddress(email));

        var client = new SendGridClient(apiKey);
        try
        {
            var response = await client.SendEmailAsync(message, cancellationToken);
            if ((int)response.StatusCode is < 200 or >= 300)
            {
                throw new HttpRequestException(
                    $"SendGrid no aceptó el correo de recuperación (HTTP {(int)response.StatusCode}).",
                    null,
                    response.StatusCode);
            }
        }
        catch (HttpRequestException exception)
        {
            if (environment.IsDevelopment())
            {
                logger.LogWarning(exception, "Se usará el código local porque SendGrid no pudo enviar el correo.");
                Console.WriteLine($"Código de restablecimiento para {email}: {codigo}");
                return;
            }

            logger.LogError(exception, "No se pudo enviar el correo de recuperación mediante SendGrid.");
            throw;
        }
    }
}
