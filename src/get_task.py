import json

def lambda_handler(event, context):
    task_id = event.get("pathParameters", {}).get("id")
    return {
        "statusCode": 200,
        "body": json.dumps({"id": task_id})
    }
