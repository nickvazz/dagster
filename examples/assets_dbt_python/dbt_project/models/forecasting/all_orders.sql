select order_date, num_orders from {{ source("forecasting", "predicted_orders") }}