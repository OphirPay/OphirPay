# ophirpay/settings.py (or equivalent Django settings module)
# Ensure session cookie hardening is enforced
SESSION_COOKIE_SECURE = True
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = 'Strict'

# ophirpay/tests/test_session_security.py
from django.test import TestCase, override_settings
from django.conf import settings
from django.contrib.auth import get_user_model
from django.test import Client

User = get_user_model()


class SessionCookieSecurityTest(TestCase):
    """Test that session cookies are hardened against common attacks."""

    def test_session_cookie_settings(self):
        """Verify session cookie security flags are properly set."""
        self.assertTrue(
            settings.SESSION_COOKIE_SECURE,
            "SESSION_COOKIE_SECURE must be True to ensure cookies are sent only over HTTPS."
        )
        self.assertTrue(
            settings.SESSION_COOKIE_HTTPONLY,
            "SESSION_COOKIE_HTTPONLY must be True to prevent JavaScript access to session cookies."
        )
        self.assertIn(
            settings.SESSION_COOKIE_SAMESITE,
            ('Strict', 'Lax'),
            "SESSION_COOKIE_SAMESITE must be 'Strict' or 'Lax' to mitigate CSRF attacks."
        )

    def test_login_sets_secure_session_cookie(self):
        """Verify login sets session cookie with expected security attributes."""
        # Create test user
        user = User.objects.create_user(username='testuser', password='testpass123')
        client = Client()

        # Perform login
        response = client.post('/login/', {'username': 'testuser', 'password': 'testpass123'})

        # Check session cookie exists and has required attributes
        session_cookie = response.cookies.get(settings.SESSION_COOKIE_NAME)
        self.assertIsNotNone(session_cookie, "Session cookie should be set after login.")
        self.assertEqual(session_cookie.get('secure'), 'Secure', "Session cookie must have 'Secure' attribute.")
        self.assertEqual(session_cookie.get('httponly'), 'True', "Session cookie must have 'HttpOnly' attribute.")
        self.assertIn(
            session_cookie.get('samesite'),
            ('Strict', 'Lax'),
            "Session cookie must have 'SameSite' attribute set to 'Strict' or 'Lax'."
        )