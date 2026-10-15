from flask import jsonify

class PaymentController:
    @staticmethod
    def handle_error(error_code, error_message):
        response = {
            "type": "https://example.com/probs/" + str(error_code),
            "title": error_message,
            "status": error_code,
            "detail": "Detailed information about the error.",
            "instance": "unique-instance-id"
        }
        return jsonify(response), error_code

    @app.route('/payments', methods=['POST'])
    def create_payment():
        try:
            # Payment creation logic
            pass
        except Exception as e:
            return PaymentController.handle_error(400, str(e))

    @app.route('/payments/<id>', methods=['GET'])
    def get_payment(id):
        try:
            # Payment retrieval logic
            pass
        except Exception as e:
            return PaymentController.handle_error(404, str(e))

    # Additional routes with similar error handling