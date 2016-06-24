    $(function(){
        $("[data-toggle=tooltip]").tooltip({
            placement:'bottom'
        });
        $("[data-toggle=popover]").popover({

        });
    });
    $(document).on('click','.navbar-collapse.in',function(e) {
        if( $(e.target).is('a') ) {
            $(this).collapse('hide');
        }
    });