import os
import json

import boto3
from boto3.dynamodb.conditions import Key

ddb = boto3.resource("dynamodb")
TABLE_NAME = os.environ["TABLE_NAME"]


def _resp(status_code: int, body_obj=None):
    return {
        "statusCode": int(status_code),
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token",
            "Access-Control-Allow-Methods": "OPTIONS,GET,POST,PUT,DELETE",
        },
        "body": "" if body_obj is None else json.dumps(body_obj),
    }


def lambda_handler(event, context):
    table = ddb.Table(TABLE_NAME)

    # Query all tasks from GSI2 (no Scan)
    resp = table.query(
        IndexName="GSI2",
        KeyConditionExpression=Key("GSI2PK").eq("TASK"),
        ProjectionExpression="#cat, EntityType",
        ExpressionAttributeNames={"#cat": "Category"},
    )

    items = resp.get("Items", [])

    categories = set()
    for it in items:
        if it.get("EntityType") != "Task":
            continue
        cat = (it.get("Category") or "").strip()
        if cat:
            categories.add(cat)

    return _resp(200, sorted(categories))
